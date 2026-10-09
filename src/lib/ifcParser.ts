/**
 * Minimal IFC-SPF (STEP) parser for the browser.
 * Scope (honest): extracts element identity, classification, names,
 * material assignments, property sets (incl. thermal transmittance where
 * present) and quantity sets. Produces approximate box geometry for the
 * viewer from quantities/dimensions when available; otherwise elements are
 * listed with counted areas derived from quantities, or flagged unknown.
 *
 * Supported: IFC2X3 + IFC4 STEP files (.ifc). Revit .rvt is NOT supported —
 * callers must surface the "export to IFC" guidance.
 */
import type { BuildingElement, BuildingModel, Provenance } from './types';

interface RawEntity {
  id: number;
  type: string;
  args: string;
}

const ENVELOPE_TYPES = new Map<string, BuildingElement['category']>([
  ['IFCWALL', 'wall'],
  ['IFCWALLSTANDARDCASE', 'wall'],
  ['IFCCURTAINWALL', 'wall'],
  ['IFCWINDOW', 'window'],
  ['IFCDOOR', 'door'],
  ['IFCSLAB', 'floor'],
  ['IFCROOF', 'roof'],
  ['IFCBUILDINGSTOREY', 'storey'],
  ['IFCSPACE', 'space'],
]);

function parseHeader(text: string): { schema: string } {
  const m = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/);
  return { schema: m ? m[1] : 'unknown' };
}

function splitEntities(dataSection: string): RawEntity[] {
  const out: RawEntity[] = [];
  // Match #123=IFCTYPE(...); — args may contain nested parens; use balanced scan.
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  const starts: { id: number; type: string; openIdx: number }[] = [];
  while ((m = re.exec(dataSection)) !== null) {
    starts.push({ id: Number(m[1]), type: m[2], openIdx: m.index + m[0].length - 1 });
  }
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let j = s.openIdx; j < dataSection.length; j++) {
      const ch = dataSection[j];
      if (ch === "'" && dataSection[j - 1] !== '\\') inStr = !inStr;
      if (inStr) continue;
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end > 0) out.push({ id: s.id, type: s.type, args: dataSection.slice(s.openIdx + 1, end) });
  }
  return out;
}

/** Split top-level comma-separated args respecting parens/quotes. */
function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === "'" && args[i - 1] !== '\\') {
      inStr = !inStr;
      cur += ch;
      continue;
    }
    if (inStr) {
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur.trim());
  return parts;
}

function refId(token: string): number | null {
  const m = token.trim().match(/^#(\d+)$/);
  return m ? Number(m[1]) : null;
}

function refList(token: string): number[] {
  const inner = token.trim().replace(/^\(/, '').replace(/\)$/, '');
  const ids: number[] = [];
  const re = /#(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) ids.push(Number(m[1]));
  return ids;
}

function strVal(token: string): string {
  const m = token.trim().match(/^'(.*)'$/s);
  return m ? m[1] : token.trim();
}

function numVal(token: string): number | null {
  const t = token.trim();
  if (t === '$' || t === '*' || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface IfcParseProgress {
  phase: string;
  fraction: number;
}

export async function parseIfcText(
  text: string,
  fileName: string,
  onProgress?: (p: IfcParseProgress) => void,
): Promise<BuildingModel> {
  onProgress?.({ phase: 'Reading header', fraction: 0.05 });
  await tick();
  const { schema } = parseHeader(text.slice(0, 20000));
  const dataStart = text.indexOf('DATA;');
  const dataEnd = text.lastIndexOf('ENDSEC;');
  if (dataStart < 0 || dataEnd < 0) throw new Error('Not a valid IFC-SPF file: DATA section not found.');
  const data = text.slice(dataStart + 5, dataEnd);
  onProgress?.({ phase: 'Scanning entities', fraction: 0.2 });
  await tick();
  const entities = splitEntities(data);
  onProgress?.({ phase: `Indexing ${entities.length} entities`, fraction: 0.4 });
  await tick();

  const byId = new Map<number, RawEntity>();
  for (const e of entities) byId.set(e.id, e);

  // Collect names / property sets / quantities / materials.
  const relDefines: { related: number[]; props: number }[] = [];
  const relMaterials: { related: number[]; material: number }[] = [];
  const containment: { related: number[]; storey: number }[] = [];
  const storeyNames = new Map<number, string>();
  for (const e of entities) {
    if (e.type === 'IFCRELDEFINESBYPROPERTIES') {
      const a = splitArgs(e.args);
      // IFC2x3: (#.., GlobalId, OwnerHistory, Name, Description?, RelatedObjects, RelatingPropertyDefinition)
      const related = refList(a[4] ?? '()');
      const props = refId(a[5] ?? '') ?? -1;
      if (props > 0) relDefines.push({ related, props });
    } else if (e.type === 'IFCRELASSOCIATESMATERIAL') {
      const a = splitArgs(e.args);
      const related = refList(a[4] ?? '()');
      const material = refId(a[5] ?? '') ?? -1;
      if (material > 0) relMaterials.push({ related, material });
    } else if (e.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE' || e.type === 'IFCRELAGGREGATES') {
      const a = splitArgs(e.args);
      const relating = refId(a[4] ?? '') ?? -1;
      const related = refList(a[5] ?? '()');
      if (relating > 0) containment.push({ related, storey: relating });
    } else if (e.type === 'IFCBUILDINGSTOREY') {
      const a = splitArgs(e.args);
      storeyNames.set(e.id, strVal(a[2] ?? `"Storey ${e.id}"`) || `Storey ${e.id}`);
    }
  }

  // Resolve property/quantity definitions.
  const propsByObj = new Map<number, { uValue?: number; materials: string[]; quantities: Record<string, number>; psetNames: string[] }>();
  const matNameById = new Map<number, string>();
  for (const e of entities) {
    if (e.type === 'IFCMATERIAL') {
      const a = splitArgs(e.args);
      matNameById.set(e.id, strVal(a[0] ?? 'Material'));
    } else if (e.type === 'IFCMATERIALLAYERSET' || e.type === 'IFCMATERIALLIST') {
      matNameById.set(e.id, e.type === 'IFCMATERIALLAYERSET' ? 'Layer set' : 'Material list');
    }
  }
  // Material layer set usages → resolve layer names.
  const layerNames = new Map<number, string>();
  for (const e of entities) {
    if (e.type === 'IFCMATERIALLAYER') {
      const a = splitArgs(e.args);
      const mid = refId(a[0] ?? '') ?? -1;
      layerNames.set(e.id, matNameById.get(mid) ?? `Layer ${e.id}`);
    }
  }
  for (const e of entities) {
    if (e.type === 'IFCMATERIALLAYERSET') {
      const a = splitArgs(e.args);
      const layers = refList(a[0] ?? '()');
      matNameById.set(
        e.id,
        layers.map((l) => layerNames.get(l) ?? `layer ${l}`).join(' + ') || 'Layer set',
      );
    }
  }

  const getOr = (id: number) => {
    let v = propsByObj.get(id);
    if (!v) {
      v = { materials: [], quantities: {}, psetNames: [] };
      propsByObj.set(id, v);
    }
    return v;
  };

  for (const rel of relDefines) {
    const def = byId.get(rel.props);
    if (!def) continue;
    if (def.type === 'IFCELEMENTQUANTITY' || def.type === 'IFCQUANTITYSET') {
      const a = splitArgs(def.args);
      const qids = refList(a[a.length - 1] ?? '()');
      const quantities: Record<string, number> = {};
      for (const q of qids) {
        const qe = byId.get(q);
        if (!qe) continue;
        const qa = splitArgs(qe.args);
        // IFCQUANTITYLENGTH/AREA/VOLUME(Name, Description, Unit?, Value)
        const qname = strVal(qa[0] ?? '').toLowerCase();
        const candidates = qa.map(numVal).filter((n): n is number => n !== null);
        const val = candidates[candidates.length - 1] ?? null;
        if (val !== null) quantities[qname] = val;
      }
      for (const r of rel.related) Object.assign(getOr(r).quantities, quantities);
    } else if (def.type === 'IFCPROPERTYSET') {
      const a = splitArgs(def.args);
      const psetName = strVal(a[2] ?? '');
      const pids = refList(a[a.length - 1] ?? '()');
      for (const r of rel.related) getOr(r).psetNames.push(psetName);
      for (const p of pids) {
        const pe = byId.get(p);
        if (!pe) continue;
        const pa = splitArgs(pe.args);
        const pname = strVal(pa[0] ?? '').toLowerCase();
        // Numeric value may be bare (0.32) or wrapped in a typed measure
        // such as IFCTHERMALTRANSMITTANCEMEASURE(0.32) — extract accordingly.
        const nums: number[] = [];
        for (const tok of pa.slice(1)) {
          const bare = numVal(tok);
          if (bare !== null) {
            nums.push(bare);
            continue;
          }
          const m = tok.match(/\(\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)/);
          if (m) nums.push(Number(m[1]));
        }
        const lastNum = nums[nums.length - 1] ?? null;
        if (
          lastNum !== null &&
          (pname.includes('thermaltransmittance') || pname.includes('u-value') || pname.includes('uvalue'))
        ) {
          for (const r of rel.related) getOr(r).uValue = lastNum;
        }
      }
    }
  }
  for (const rel of relMaterials) {
    const mdef = byId.get(rel.material);
    let label = `Material #${rel.material}`;
    if (mdef) {
      if (mdef.type === 'IFCMATERIAL') label = matNameById.get(rel.material) ?? label;
      else if (mdef.type === 'IFCMATERIALLAYERSETUSAGE' || mdef.type === 'IFCMATERIALLAYERSET') {
        const a = splitArgs(mdef.args);
        const setId = refId(a[0] ?? '') ?? rel.material;
        label = matNameById.get(setId) ?? matNameById.get(rel.material) ?? label;
      }
    }
    for (const r of rel.related) getOr(r).materials.push(label);
  }
  const storeyOf = new Map<number, string>();
  for (const c of containment) {
    const sname = storeyNames.get(c.storey);
    if (sname) for (const r of c.related) storeyOf.set(r, sname);
  }

  onProgress?.({ phase: 'Extracting envelope elements', fraction: 0.65 });
  await tick();

  const elements: BuildingElement[] = [];
  const warnings: string[] = [];
  let uFound = 0;
  let uMissing = 0;
  let spaceCount = 0;
  const storeys = [...storeyNames.values()];

  // Element naming: IFCROOT args → GlobalId(0), OwnerHistory(1), Name(2), Description(3)
  for (const e of entities) {
    const cat = ENVELOPE_TYPES.get(e.type);
    if (!cat) continue;
    if (cat === 'storey') continue;
    if (cat === 'space') {
      spaceCount++;
      continue;
    }
    const a = splitArgs(e.args);
    const globalId = strVal(a[0] ?? '');
    const name = strVal(a[2] ?? '') || `${e.type} #${e.id}`;
    const info = propsByObj.get(e.id);
    const q = info?.quantities ?? {};
    // Area candidates (m²): prefer net/gross side areas, then generic area.
    const area =
      q['netsidearea'] ?? q['grosssidearea'] ?? q['netarea'] ?? q['grossarea'] ??
      q['area'] ?? q['netvolume'] ?? null;
    let areaM2 = 0;
    let areaProv: Provenance = 'unknown';
    if (area !== null && Number.isFinite(area) && area > 0 && area < 100000) {
      areaM2 = area;
      areaProv = 'extracted';
    } else {
      // Fall back to Length×Height / Length×Width for walls/slabs.
      const L = q['length'] ?? q['overalllength'] ?? q['netlength'];
      const H = q['height'] ?? q['overallheight'] ?? q['netheight'] ?? q['width'] ?? q['overallwidth'];
      if (L && H && L > 0 && H > 0 && L < 500 && H < 100) {
        areaM2 = L * H;
        areaProv = 'derived';
      } else {
        areaM2 = 0;
        areaProv = 'unknown';
      }
    }
    let uProv: Provenance = 'unknown';
    let uVal: number | undefined;
    if (info?.uValue !== undefined && Number.isFinite(info.uValue) && info.uValue > 0 && info.uValue < 10) {
      uVal = info.uValue;
      uProv = 'extracted';
      uFound++;
    } else {
      uMissing++;
    }
    const mat = info?.materials?.[0];
    // Approximate placement box for viewer: spread along X by index.
    const idx = elements.length;
    const wb = Math.sqrt(Math.max(areaM2, 1));
    elements.push({
      id: `ifc-${e.id}`,
      globalId,
      ifcType: e.type,
      name,
      category: cat,
      areaM2: +areaM2.toFixed(2),
      areaProvenance: areaProv,
      uValueWm2K: uVal,
      uProvenance: uProv,
      material: mat,
      materialProvenance: mat ? 'extracted' : 'unknown',
      dims:
        cat === 'wall'
          ? { x: Math.min(wb, 12), y: 3, z: 0.25 }
          : cat === 'window' || cat === 'door'
            ? { x: Math.min(wb, 4), y: 1.8, z: 0.12 }
            : cat === 'roof' || cat === 'floor'
              ? { x: Math.min(wb, 12), y: 0.25, z: Math.min(wb, 12) }
              : undefined,
      center: { x: (idx % 8) * 4 - 14, y: cat === 'roof' ? 7 : cat === 'floor' ? 0 : 3, z: Math.floor(idx / 8) * 5 - 6 },
      storey: storeyOf.get(e.id),
    });
    // Yield periodically for large files.
    if (elements.length % 400 === 0) {
      onProgress?.({ phase: `Extracting envelope elements (${elements.length})`, fraction: 0.7 });
      await tick();
    }
  }

  if (elements.length === 0) {
    throw new Error(
      'No envelope elements (walls, windows, doors, slabs, roofs) found in this file. It may be a structural/MEP-only model or an unsupported IFC configuration.',
    );
  }
  const unknownAreas = elements.filter((e) => e.areaProvenance === 'unknown').length;
  warnings.push(
    `${elements.length} envelope elements indexed from ${entities.length} IFC entities (${schema}).`,
  );
  if (uFound === 0)
    warnings.push(
      'No thermal transmittance (U-values) found in property sets — defaults/assumptions will be used and are labelled as such.',
    );
  else warnings.push(`${uFound} elements carry extracted U-values; ${uMissing} use defaults.`);
  if (unknownAreas > 0)
    warnings.push(
      `${unknownAreas} elements have no usable quantity — their area reads 0 and is excluded from heat-loss totals until quantities or manual values are supplied.`,
    );
  warnings.push('Viewer geometry is an approximation (boxes from quantities), not the original B-rep.');

  // Floor area / volume from spaces or slabs.
  const slabArea = elements.filter((e) => e.category === 'floor').reduce((a, e) => a + e.areaM2, 0);
  const floorAreaM2 = slabArea > 0 ? slabArea : 200;
  const floorProv: Provenance = slabArea > 0 ? 'derived' : 'assumption';
  if (slabArea === 0) warnings.push('Floor area fallback of 200 m² assumed (no slab quantities).');
  const volumeM3 = floorAreaM2 * 3.2;
  const projName = fileName.replace(/\.ifc$/i, '');

  onProgress?.({ phase: 'Done', fraction: 1 });
  return {
    name: projName || 'Imported IFC model',
    source: 'ifc',
    sourceFileName: fileName,
    schema,
    storeys: storeys.length ? storeys : ['(storeys not identified)'],
    spaces: spaceCount,
    elements,
    floorAreaM2: +floorAreaM2.toFixed(1),
    floorAreaProvenance: floorProv,
    volumeM3: +volumeM3.toFixed(1),
    volumeProvenance: 'derived',
    warnings,
    geometryFidelity: 'approximate',
  };
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function validateIfcFile(file: File): string | null {
  if (!/\.ifc$/i.test(file.name)) {
    if (/\.rvt$/i.test(file.name))
      return 'Revit .rvt files cannot be parsed in the browser. Export the model to IFC from Revit (File → Export → IFC) and upload the .ifc file instead.';
    return `Unsupported file type "${file.name}". Upload an IFC (.ifc) STEP file, or a previously exported normalized model (.json).`;
  }
  if (file.size > 150 * 1024 * 1024) return 'File exceeds the 150 MB browser parsing limit.';
  if (file.size === 0) return 'File is empty.';
  return null;
}
