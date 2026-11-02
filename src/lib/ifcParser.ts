/**
 * Minimal IFC-SPF (STEP) parser for the browser.
 * Scope (honest): extracts element identity, classification, names, material
 * assignments (occurrence- and type-level), property sets (incl. thermal
 * transmittance where present), quantity sets, project length units, and
 * real placement/shape geometry:
 *   - IfcLocalPlacement chains (position + rotation) → world transforms
 *   - IfcExtrudedAreaSolid (rectangle / circle / polyline profiles)
 *   - IfcMappedItem (type geometry reuse) with mapping transforms
 *   - Face-based / faceted surface models via referenced-point bounding boxes
 *   - IfcBoundingBox items
 * Viewer boxes are oriented world-space bounding boxes of the above
 * (boolean clippings/openings approximated by the unclipped solid), NOT the
 * original B-rep. Structural parts (members, plates, beams, columns, …) are
 * extracted for viewer completeness but excluded from heat-loss math.
 * Envelope areas prefer quantities, then door/window overall dimensions,
 * then geometry-derived bounding faces, else unknown.
 *
 * Supported: IFC2X3 + IFC4 STEP files (.ifc). Revit .rvt is NOT supported —
 * callers must surface the "export to IFC" guidance.
 */
import * as WebIFC from 'web-ifc';
import { resolveMaterialUValue } from './materialLibrary';
import type { BuildingElement, BuildingModel, MeshGeometryData, Provenance } from './types';

interface RawEntity {
  id: number;
  type: string;
  args: string;
}

const CATEGORY = new Map<string, BuildingElement['category']>([
  ['IFCWALL', 'wall'],
  ['IFCWALLSTANDARDCASE', 'wall'],
  ['IFCCURTAINWALL', 'wall'],
  ['IFCWINDOW', 'window'],
  ['IFCDOOR', 'door'],
  ['IFCSLAB', 'floor'],
  ['IFCROOF', 'roof'],
  ['IFCCOLUMN', 'structure'],
  ['IFCBEAM', 'structure'],
  ['IFCMEMBER', 'structure'],
  ['IFCPLATE', 'structure'],
  ['IFCFOOTING', 'structure'],
  ['IFCPILE', 'structure'],
  ['IFCSTAIR', 'structure'],
  ['IFCSTAIRFLIGHT', 'structure'],
  ['IFCRAMP', 'structure'],
  ['IFCCOVERING', 'structure'],
  ['IFCBUILDINGELEMENTPROXY', 'structure'],
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

/** All bare numbers inside a token (handles typed measures like LENGTH(2.5)). */
function allNums(token: string): number[] {
  const out: number[] = [];
  const re = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(token)) !== null) out.push(Number(m[0]));
  return out.filter(Number.isFinite);
}

export interface IfcParseProgress {
  phase: string;
  fraction: number;
}

// ---------------------------------------------------------------------------
// Minimal 4x4 rigid-transform math (row-major). Placements are rigid
// (rotation + translation), so inversion is transpose + negated offset.
// ---------------------------------------------------------------------------
type Mat4 = number[]; // 16 numbers, row-major
type Vec3 = [number, number, number];

const IDENT: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  return o;
}

function invertRigid(m: Mat4): Mat4 {
  // Rotation rows R0..R2, translation t. Inverse: R^T, t' = -R^T·t.
  const t: Vec3 = [m[3], m[7], m[11]];
  const rT = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0];
  const nt: Vec3 = [
    -(rT[0] * t[0] + rT[1] * t[1] + rT[2] * t[2]),
    -(rT[4] * t[0] + rT[5] * t[1] + rT[6] * t[2]),
    -(rT[8] * t[0] + rT[9] * t[1] + rT[10] * t[2]),
  ];
  return [...rT.slice(0, 3), nt[0], ...rT.slice(4, 7), nt[1], ...rT.slice(8, 11), nt[2], 0, 0, 0, 1];
}

function xform(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

/** Determinant of the upper 3×3 (negative = mirrored, unusable as rotation). */function det3(m: Mat4): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

/** Rotation part of a rigid matrix → quaternion, or null if mirrored. */
function matToQuat(m: Mat4): [number, number, number, number] | null {
  if (det3(m) <= 1e-9) return null;
  // Normalize columns (strip any scale) before conversion.
  const cx = Math.hypot(m[0], m[4], m[8]) || 1;
  const cy = Math.hypot(m[1], m[5], m[9]) || 1;
  const cz = Math.hypot(m[2], m[6], m[10]) || 1;
  const r = [
    m[0] / cx, m[1] / cy, m[2] / cz,
    m[4] / cx, m[5] / cy, m[6] / cz,
    m[8] / cx, m[9] / cy, m[10] / cz,
  ];
  const tr = r[0] + r[4] + r[8];
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 1;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4;
    x = (r[7] - r[5]) / s;
    y = (r[2] - r[6]) / s;
    z = (r[3] - r[1]) / s;
  } else if (r[0] > r[4] && r[0] > r[8]) {
    const s = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2;
    w = (r[7] - r[5]) / s;
    x = s / 4;
    y = (r[1] + r[3]) / s;
    z = (r[2] + r[6]) / s;
  } else if (r[4] > r[8]) {
    const s = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2;
    w = (r[2] - r[6]) / s;
    x = (r[1] + r[3]) / s;
    y = s / 4;
    z = (r[5] + r[7]) / s;
  } else {
    const s = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2;
    w = (r[3] - r[1]) / s;
    x = (r[2] + r[6]) / s;
    y = (r[5] + r[7]) / s;
    z = s / 4;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/**
 * IFC is Z-up, the viewer is Y-up (P swaps Y/Z). A viewer-space rotation is
 * the similarity transform P·R·P, which preserves proper rotations.
 */
function viewerQuat(wf: Mat4): [number, number, number, number] | null {
  const px = [0, 2, 1];
  const o = [...wf];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = wf[px[r] * 4 + px[c]];
  return matToQuat(o);
}

interface Box {
  min: Vec3;
  max: Vec3;
}

function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { min: [...b.min] as Vec3, max: [...b.max] as Vec3 };
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

function boxOfPoints(pts: Vec3[]): Box | null {
  if (!pts.length) return null;
  let b: Box | null = null;
  for (const p of pts) b = unionBox(b, { min: [...p] as Vec3, max: [...p] as Vec3 });
  return b;
}

function boxDims(b: Box): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

function maxFaceArea(b: Box): number {
  const [dx, dy, dz] = boxDims(b);
  return Math.max(dx * dy, dx * dz, dy * dz);
}

async function parseIfcTextInternal(
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
  onProgress?.({ phase: 'Scanning entities', fraction: 0.15 });
  await tick();
  const entities = splitEntities(data);
  onProgress?.({ phase: `Indexing ${entities.length} entities`, fraction: 0.3 });
  await tick();

  const byId = new Map<number, RawEntity>();
  for (const e of entities) byId.set(e.id, e);

  // Cached arg splitting (placements/reps are revisited constantly).
  const argsCache = new Map<number, string[]>();
  const E = (id: number): string[] => {
    let a = argsCache.get(id);
    if (!a) {
      const e = byId.get(id);
      a = e ? splitArgs(e.args) : [];
      if (argsCache.size < 4000000) argsCache.set(id, a);
    }
    return a;
  };
  const T = (id: number): string => byId.get(id)?.type ?? '';

  // ---- length unit scale (project units; Revit metric exports use mm) ----
  let unitScale = 1;
  let unitLabel = 'metre';
  let unitUnresolved = false;
  for (const e of entities) {
    if (e.type !== 'IFCPROJECT') continue;
    const a = splitArgs(e.args);
    const unitsId = refId(a[8] ?? '');
    const ua = unitsId ? byId.get(unitsId) : undefined;
    if (!ua || ua.type !== 'IFCUNITASSIGNMENT') {
      unitUnresolved = true;
      break;
    }
    const list = refList(splitArgs(ua.args)[0] ?? '()');
    let found = false;
    for (const u of list) {
      const ue = byId.get(u);
      if (!ue || ue.type !== 'IFCSIUNIT') continue;
      const qa = splitArgs(ue.args);
      if ((qa[1] ?? '').trim() !== '.LENGTHUNIT.') continue;
      found = true;
      const prefix = (qa[2] ?? '').trim();
      const PREFIX: Record<string, number> = {
        '.MILLI.': 1e-3, '.CENTI.': 1e-2, '.DECI.': 1e-1, '.MICRO.': 1e-6,
        '.KILO.': 1e3, '$': 1, '*': 1, '': 1,
      };
      if (prefix in PREFIX) {
        unitScale = PREFIX[prefix];
        unitLabel = prefix === '$' || prefix === '' ? 'metre' : `${prefix.replace(/\./g, '').toLowerCase()}metre`;
      } else {
        unitUnresolved = true;
      }
      break;
    }
    if (!found) unitUnresolved = true;
    break; // first project only
  }

  // ---- geometry helpers (scale-aware) ----
  const S = unitScale;
  const getPoint = (id: number): Vec3 | null => {
    if (T(id) !== 'IFCCARTESIANPOINT') return null;
    const n = allNums(E(id)[0] ?? '');
    if (!n.length) return null;
    return [n[0] * S, (n[1] ?? 0) * S, (n[2] ?? 0) * S];
  };
  const getDir = (id: number): Vec3 | null => {
    if (T(id) !== 'IFCDIRECTION') return null;
    const n = allNums(E(id)[0] ?? '');
    if (n.length < 2) return null;
    const v: Vec3 = [n[0], n[1], n[2] ?? 0];
    const l = Math.hypot(v[0], v[1], v[2]);
    if (!(l > 1e-12)) return null;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (v: Vec3): Vec3 | null => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : null;
  };
  const placementMatrix = (axisId: number): Mat4 => {
    // IfcAxis2Placement3D(Location, Axis?, RefDirection?)
    if (T(axisId) !== 'IFCAXIS2PLACEMENT3D') return [...IDENT];
    const a = E(axisId);
    const p = getPoint(refId(a[0] ?? '') ?? -1) ?? [0, 0, 0];
    let z = (refId(a[1] ?? '') ? getDir(refId(a[1] ?? '') ?? -1) : null) ?? ([0, 0, 1] as Vec3);
    let x0 = (refId(a[2] ?? '') ? getDir(refId(a[2] ?? '') ?? -1) : null) ?? ([1, 0, 0] as Vec3);
    z = norm(z) ?? ([0, 0, 1] as Vec3);
    x0 = norm(x0) ?? ([1, 0, 0] as Vec3);
    let y = norm(cross(z, x0));
    if (!y) {
      // Degenerate: pick any perpendicular.
      y = Math.abs(z[2]) < 0.9 ? norm(cross(z, [0, 0, 1]))! : norm(cross(z, [0, 1, 0]))!;
    }
    const x = cross(y, z);
    return [
      x[0], y[0], z[0], p[0],
      x[1], y[1], z[1], p[1],
      x[2], y[2], z[2], p[2],
      0,    0,    0,    1,
    ];
  };
  const placeCache = new Map<number, Mat4>();
  const worldOfPlacement = (id: number, seen = new Set<number>()): Mat4 => {
    const hit = placeCache.get(id);
    if (hit) return hit;
    if (T(id) !== 'IFCLOCALPLACEMENT' || seen.has(id)) return [...IDENT];
    seen.add(id);
    const a = E(id);
    const parent = refId(a[0] ?? '');
    const local = placementMatrix(refId(a[1] ?? '') ?? -1);
    const w = parent ? mul(worldOfPlacement(parent, seen), local) : local;
    if (placeCache.size < 1000000) placeCache.set(id, w);
    return w;
  };

  // ---- profile bounding boxes (representation-local coords) ----
  const profileBox = (id: number): Box | null => {
    const t = T(id);
    const a = E(id);
    if (
      t === 'IFCRECTANGLEPROFILEDEF' ||
      t === 'IFCISHAPEPROFILEDEF' ||
      t === 'IFCLSHAPEPROFILEDEF' ||
      t === 'IFCTSHAPEPROFILEDEF' ||
      t === 'IFCUSHAPEPROFILEDEF' ||
      t === 'IFCCSHAPEPROFILEDEF'
    ) {
      const xd = numVal(a[3] ?? '') ?? 0;
      const yd = numVal(a[4] ?? '') ?? 0;
      if (!(xd > 0 && yd > 0)) return null;
      // 2D position offset (IfcAxis2Placement2D: Location, RefDirection).
      let ox = 0;
      let oy = 0;
      let c = 1;
      let s = 0;
      const p2 = refId(a[2] ?? '');
      if (p2 && T(p2) === 'IFCAXIS2PLACEMENT2D') {
        const pa = E(p2);
        const loc = getPoint(refId(pa[0] ?? '') ?? -1);
        if (loc) {
          ox = loc[0];
          oy = loc[1];
        }
        const rd = refId(pa[1] ?? '');
        const d = rd ? getDir(rd) : null;
        if (d) {
          const l = Math.hypot(d[0], d[1]) || 1;
          c = d[0] / l;
          s = d[1] / l;
        }
      }
      const hx = (xd * S) / 2;
      const hy = (yd * S) / 2;
      const corners: Vec3[] = [];
      const quad: Array<[number, number]> = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
      for (const [qx, qy] of quad) {
        corners.push([ox + qx * c - qy * s, oy + qx * s + qy * c, 0]);
      }
      return boxOfPoints(corners);
    }
    if (t === 'IFCCIRCLEPROFILEDEF') {
      const nums = allNums(a.slice(3).join(','));
      const r = nums[nums.length - 1] ?? 0;
      if (!(r > 0)) return null;
      const rr = r * S;
      return { min: [-rr, -rr, 0], max: [rr, rr, 0] };
    }
    if (t === 'IFCARBITRARYCLOSEDPROFILEDEF' || t === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
      const curve = refId(a[2] ?? '');
      if (curve) {
        const pts: Vec3[] = [];
        if (T(curve) === 'IFCPOLYLINE') {
          for (const p of refList(E(curve)[0] ?? '()')) {
            const pt = getPoint(p);
            if (pt) pts.push(pt);
            if (pts.length > 2000) break;
          }
        } else {
          collectPoints(curve, 0, new Set(), pts);
        }
        if (pts.length > 0) return boxOfPoints(pts);
      }
      return null;
    }
    return null;
  };

  // ---- representation traversal → local boxes (cached per rep entity) ----
  const repCache = new Map<number, Box[]>();
  let repVisiting = new Set<number>();
  let clippedCount = 0;
  const localBoxes = (repId: number, depth = 0): Box[] => {
    const hit = repCache.get(repId);
    if (hit) return hit;
    if (depth > 10 || repVisiting.has(repId)) return [];
    const t = T(repId);
    if (!t) return [];
    repVisiting.add(repId);
    let out: Box[] = [];
    try {
      const a = E(repId);
      if (t === 'IFCPRODUCTDEFINITIONSHAPE') {
        const reps = refList(a[2] ?? '()');
        // Prefer solid/surface reps over wireframe/axis boxes.
        const scored = reps
          .map((r) => ({ r, score: repScore(r) }))
          .sort((x, y) => y.score - x.score);
        for (const { r } of scored.slice(0, 3)) out.push(...localBoxes(r, depth + 1));
      } else if (t === 'IFCSHAPEREPRESENTATION') {
        for (const item of refList(a[3] ?? '()')) out.push(...localBoxes(item, depth + 1));
      } else if (t === 'IFCEXTRUDEDAREASOLID') {
        const prof = profileBox(refId(a[0] ?? '') ?? -1);
        const dir = getDir(refId(a[2] ?? '') ?? -1) ?? ([0, 0, 1] as Vec3);
        const dep = (numVal(a[3] ?? '') ?? 0) * S;
        if (prof && dep > 0) {
          const pos = placementMatrix(refId(a[1] ?? '') ?? -1);
          const [dx0, dx1] = [prof.min[0], prof.max[0]];
          const [dy0, dy1] = [prof.min[1], prof.max[1]];
          const pts: Vec3[] = [];
          for (const cx of [dx0, dx1])
            for (const cy of [dy0, dy1]) {
              pts.push(xform(pos, [cx, cy, 0]));
              pts.push(xform(pos, [cx + dir[0] * dep, cy + dir[1] * dep, dir[2] * dep]));
            }
          const b = boxOfPoints(pts);
          if (b) out.push(b);
        }
      } else if (t === 'IFCMAPPEDITEM') {
        const mapId = refId(a[0] ?? '');
        const tgtId = refId(a[1] ?? '');
        const tgt = tgtId
          ? T(tgtId) === 'IFCCARTESIANTRANSFORMATIONOPERATOR3D'
            ? operatorMatrix(tgtId)
            : placementMatrix(tgtId)
          : [...IDENT];
        if (mapId && T(mapId) === 'IFCREPRESENTATIONMAP') {
          const ma = E(mapId);
          const org = placementMatrix(refId(ma[0] ?? '') ?? -1);
          const mapped = refId(ma[1] ?? '');
          if (mapped) {
            const m = mul(tgt, invertRigid(org));
            for (const b of localBoxes(mapped, depth + 1)) {
              const corners: Vec3[] = [];
              for (let i = 0; i < 8; i++)
                corners.push(
                  xform(m, [
                    i & 1 ? b.max[0] : b.min[0],
                    i & 2 ? b.max[1] : b.min[1],
                    i & 4 ? b.max[2] : b.min[2],
                  ]),
                );
              const nb = boxOfPoints(corners);
              if (nb) out.push(nb);
            }
          }
        }
      } else if (
        t === 'IFCFACEBASEDSURFACEMODEL' ||
        t === 'IFCFACETEDBREP' ||
        t === 'IFCSHELLBASEDSURFACEMODEL' ||
        t === 'IFCOPENSHELL' ||
        t === 'IFCCLOSEDSHELL'
      ) {
        const pts = collectPoints(repId, 0, new Set(), []);
        const b = boxOfPoints(pts);
        if (b) out.push(b);
      } else if (t === 'IFCBOOLEANRESULT' || t === 'IFCBOOLEANCLIPPINGRESULT') {
        // Approximation: unclipped first operand (counted for the report).
        const first = refId(a[1] ?? '');
        if (first) {
          out.push(...localBoxes(first, depth + 1));
          clippedCount++;
        }
      } else if (t === 'IFCBOUNDINGBOX') {
        const corner = getPoint(refId(a[0] ?? '') ?? -1);
        const xd = (numVal(a[1] ?? '') ?? 0) * S;
        const yd = (numVal(a[2] ?? '') ?? 0) * S;
        const zd = (numVal(a[3] ?? '') ?? 0) * S;
        if (corner && xd > 0 && yd > 0 && zd > 0)
          out.push({
            min: [...corner] as Vec3,
            max: [corner[0] + xd, corner[1] + yd, corner[2] + zd],
          });
      }
    } finally {
      repVisiting.delete(repId);
    }
    if (repCache.size < 1000000) repCache.set(repId, out);
    return out;
  };

  const repScore = (r: number): number => {
    const rt = T(r);
    if (rt !== 'IFCSHAPEREPRESENTATION') return 1;
    const iden = strVal(E(r)[1] ?? '').toLowerCase();
    const rtype = strVal(E(r)[2] ?? '').toLowerCase();
    if (iden.includes('body') && rtype.includes('sweptsolid')) return 10;
    if (rtype.includes('sweptsolid') || rtype.includes('mappedrepresentation')) return 8;
    if (rtype.includes('surfacemodel') || rtype.includes('brep') || rtype.includes('tessellation')) return 6;
    if (rtype.includes('boundingbox')) return 4;
    return 2; // axis, box, annotation…
  };

  /** IfcCartesianTransformationOperator3D → matrix (MappingTarget support). */
  const operatorMatrix = (id: number): Mat4 => {
    if (T(id) !== 'IFCCARTESIANTRANSFORMATIONOPERATOR3D') return [...IDENT];
    const a = E(id);
    const ax1 = getDir(refId(a[0] ?? '') ?? -1) ?? ([1, 0, 0] as Vec3);
    const ax2 = getDir(refId(a[1] ?? '') ?? -1) ?? ([0, 1, 0] as Vec3);
    const org = getPoint(refId(a[2] ?? '') ?? -1) ?? ([0, 0, 0] as Vec3);
    const sc = numVal(a[3] ?? '') ?? 1;
    const ax3 = getDir(refId(a[4] ?? '') ?? -1) ?? (norm(cross(ax1, ax2)) as Vec3 | null) ?? ([0, 0, 1] as Vec3);
    const x = norm(ax1) ?? ([1, 0, 0] as Vec3);
    const z = norm(ax3) ?? ([0, 0, 1] as Vec3);
    const y = norm(cross(z, x)) ?? ([0, 1, 0] as Vec3);
    const xx = cross(y, z);
    return [
      xx[0] * sc, y[0] * sc, z[0] * sc, org[0],
      xx[1] * sc, y[1] * sc, z[1] * sc, org[1],
      xx[2] * sc, y[2] * sc, z[2] * sc, org[2],
      0,          0,          0,          1,
    ];
  };

  /**
   * Strict single-extrusion fast path: returns occurrence-local oriented
   * dims + center + solid frame, or null when the representation is anything
   * more complex (those keep axis-aligned boxes).
   */
  const extrusionSpec = (
    repId: number,
    depth: number,
    seen: Set<number>,
  ): { dims: Vec3; center: Vec3; frame: Mat4 } | null => {
    if (depth > 6 || seen.has(repId)) return null;
    const t = T(repId);
    if (!t) return null;
    seen.add(repId);
    try {
      const a = E(repId);
      if (t === 'IFCPRODUCTDEFINITIONSHAPE') {
        const reps = refList(a[2] ?? '()');
        const best = reps.map((r) => ({ r, score: repScore(r) })).sort((x, y) => y.score - x.score)[0];
        return best ? extrusionSpec(best.r, depth + 1, seen) : null;
      }
      if (t === 'IFCSHAPEREPRESENTATION') {
        const items = refList(a[3] ?? '()');
        if (items.length !== 1) return null;
        return extrusionSpec(items[0], depth + 1, seen);
      }
      if (t === 'IFCEXTRUDEDAREASOLID') {
        const prof = profileBox(refId(a[0] ?? '') ?? -1);
        const dir = getDir(refId(a[2] ?? '') ?? -1) ?? ([0, 0, 1] as Vec3);
        const dep = (numVal(a[3] ?? '') ?? 0) * S;
        if (!prof || !(dep > 0)) return null;
        const pos = placementMatrix(refId(a[1] ?? '') ?? -1);
        const corners: Vec3[] = [];
        for (const cx of [prof.min[0], prof.max[0]])
          for (const cy of [prof.min[1], prof.max[1]]) {
            corners.push(xform(pos, [cx, cy, 0]));
            corners.push(xform(pos, [cx + dir[0] * dep, cy + dir[1] * dep, dir[2] * dep]));
          }
        const b = boxOfPoints(corners);
        if (!b) return null;
        // Oriented dims measured in the solid's own frame.
        const pd = boxDims(prof);
        return {
          dims: [Math.max(pd[0], 0.02), Math.max(pd[1], 0.02), Math.max(dep, 0.02)],
          center: [
            (b.min[0] + b.max[0]) / 2,
            (b.min[1] + b.max[1]) / 2,
            (b.min[2] + b.max[2]) / 2,
          ],
          frame: pos,
        };
      }
      if (t === 'IFCMAPPEDITEM') {
        const mapId = refId(a[0] ?? '');
        if (!mapId || T(mapId) !== 'IFCREPRESENTATIONMAP') return null;
        const ma = E(mapId);
        const org = placementMatrix(refId(ma[0] ?? '') ?? -1);
        const mapped = refId(ma[1] ?? '');
        if (!mapped) return null;
        const tgtId = refId(a[1] ?? '');
        const tgt = tgtId
          ? T(tgtId) === 'IFCCARTESIANTRANSFORMATIONOPERATOR3D'
            ? operatorMatrix(tgtId)
            : placementMatrix(tgtId)
          : [...IDENT];
        const m = mul(tgt, invertRigid(org));
        const inner = extrusionSpec(mapped, depth + 1, seen);
        if (!inner) return null;
        return { dims: inner.dims, center: xform(m, inner.center), frame: mul(m, inner.frame) };
      }
      return null;
    } finally {
      seen.delete(repId);
    }
  };

  const collectPoints = (id: number, depth: number, seen: Set<number>, acc: Vec3[]): Vec3[] => {
    if (depth > 8 || seen.has(id) || acc.length > 1500) return acc;
    seen.add(id);
    const t = T(id);
    if (!t) return acc;
    if (t === 'IFCCARTESIANPOINT') {
      const p = getPoint(id);
      if (p) acc.push(p);
      return acc;
    }
    for (const r of refList(`(${E(id).join(',')})`)) collectPoints(r, depth + 1, seen, acc);
    return acc;
  };

  // ---- relationship indexes ----
  onProgress?.({ phase: 'Indexing relationships', fraction: 0.38 });
  await tick();
  const relDefines: { related: number[]; props: number }[] = [];
  const relMaterials: { related: number[]; material: number }[] = [];
  const occToType = new Map<number, number>();
  const containment: { related: number[]; storey: number }[] = [];
  const storeyNames = new Map<number, string>();
  for (const e of entities) {
    if (e.type === 'IFCRELDEFINESBYPROPERTIES') {
      const a = E(e.id);
      const related = refList(a[4] ?? '()');
      const props = refId(a[5] ?? '') ?? -1;
      if (props > 0) relDefines.push({ related, props });
    } else if (e.type === 'IFCRELDEFINESBYTYPE') {
      const a = E(e.id);
      const related = refList(a[4] ?? '()');
      const typeId = refId(a[5] ?? '') ?? -1;
      if (typeId > 0) for (const r of related) occToType.set(r, typeId);
    } else if (e.type === 'IFCRELASSOCIATESMATERIAL') {
      const a = E(e.id);
      const related = refList(a[4] ?? '()');
      const material = refId(a[5] ?? '') ?? -1;
      if (material > 0) relMaterials.push({ related, material });
    } else if (e.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE' || e.type === 'IFCRELAGGREGATES') {
      const a = E(e.id);
      const relating = refId(a[4] ?? '') ?? -1;
      const related = refList(a[5] ?? '()');
      if (relating > 0) containment.push({ related, storey: relating });
    } else if (e.type === 'IFCBUILDINGSTOREY') {
      const a = E(e.id);
      storeyNames.set(e.id, strVal(a[2] ?? `"Storey ${e.id}"`) || `Storey ${e.id}`);
    }
  }

  // Resolve property/quantity definitions (keyed by occurrence OR type id).
  onProgress?.({ phase: 'Resolving properties & materials', fraction: 0.45 });
  await tick();
  const propsByObj = new Map<number, { uValue?: number; materials: string[]; quantities: Record<string, number>; psetNames: string[] }>();
  const matNameById = new Map<number, string>();
  for (const e of entities) {
    if (e.type === 'IFCMATERIAL') {
      matNameById.set(e.id, strVal(E(e.id)[0] ?? 'Material'));
    } else if (e.type === 'IFCMATERIALLAYERSET' || e.type === 'IFCMATERIALLIST') {
      matNameById.set(e.id, e.type === 'IFCMATERIALLAYERSET' ? 'Layer set' : 'Material list');
    }
  }
  const layerNames = new Map<number, string>();
  for (const e of entities) {
    if (e.type === 'IFCMATERIALLAYER') {
      const mid = refId(E(e.id)[0] ?? '') ?? -1;
      layerNames.set(e.id, matNameById.get(mid) ?? `Layer ${e.id}`);
    }
  }
  for (const e of entities) {
    if (e.type === 'IFCMATERIALLAYERSET') {
      const layers = refList(E(e.id)[0] ?? '()');
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
      const a = E(def.id);
      const qids = refList(a[a.length - 1] ?? '()');
      const quantities: Record<string, number> = {};
      for (const q of qids) {
        const qa = E(q);
        if (!qa.length) continue;
        // IFCQUANTITYLENGTH/AREA/VOLUME/COUNT/WEIGHT/TIME(Name, …, Value)
        const qname = strVal(qa[0] ?? '').toLowerCase();
        const candidates = qa.map(numVal).filter((n): n is number => n !== null);
        const val = candidates[candidates.length - 1] ?? null;
        if (val !== null) quantities[qname] = val;
      }
      for (const r of rel.related) Object.assign(getOr(r).quantities, quantities);
    } else if (def.type === 'IFCPROPERTYSET') {
      const a = E(def.id);
      const psetName = strVal(a[2] ?? '');
      const pids = refList(a[a.length - 1] ?? '()');
      for (const r of rel.related) getOr(r).psetNames.push(psetName);
      for (const p of pids) {
        const pa = E(p);
        if (!pa.length) continue;
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
        const setId = refId(E(mdef.id)[0] ?? '') ?? rel.material;
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

  /** Merge occurrence data with its type's data (occurrence wins). */
  const infoFor = (occId: number) => {
    const own = propsByObj.get(occId);
    const typeId = occToType.get(occId);
    const tinfo = typeId ? propsByObj.get(typeId) : undefined;
    if (!tinfo) return own;
    return {
      uValue: own?.uValue ?? tinfo.uValue,
      materials: [...(own?.materials ?? []), ...tinfo.materials],
      quantities: { ...tinfo.quantities, ...(own?.quantities ?? {}) },
      psetNames: [...(own?.psetNames ?? []), ...tinfo.psetNames],
    };
  };

  onProgress?.({ phase: 'Extracting elements & geometry', fraction: 0.6 });
  await tick();

  const elements: BuildingElement[] = [];
  const warnings: string[] = [];
  let uFound = 0;
  let uMissing = 0;
  let spaceCount = 0;
  let structureCount = 0;
  let envelopeCount = 0;
  let geomResolved = 0;
  let geomFallback = 0;
  let overallMin: Vec3 | null = null;
  let overallMax: Vec3 | null = null;
  const storeys = [...storeyNames.values()];
  const slabAreasByStorey = new Map<string, number>();

  // Collect matching entities first so progress can be reported.
  const items: { e: RawEntity; cat: BuildingElement['category'] }[] = [];
  for (const e of entities) {
    const cat = CATEGORY.get(e.type);
    if (!cat || cat === 'storey') continue;
    if (cat === 'space') {
      spaceCount++;
      continue;
    }
    items.push({ e, cat });
  }

  for (let idx = 0; idx < items.length; idx++) {
    const { e, cat: initialCat } = items[idx];
    let cat = initialCat;
    const a = E(e.id);
    const globalId = strVal(a[0] ?? '');
    const name = strVal(a[2] ?? '') || `${e.type} #${e.id}`;
    const info = infoFor(e.id);
    const q = info?.quantities ?? {};

    // Reclassify glass curtain wall panels to 'window' so they render as glass, not solid orange structure
    if (
      cat === 'structure' &&
      e.type === 'IFCPLATE' &&
      ((info?.materials ?? []).some((m) => /vidrio|glass|cristal|glaz/i.test(m)) ||
        /acristalado|vidrio|glass|glaz|cristal|panel/i.test(name))
    ) {
      cat = 'window';
    }

    // Reclassify roof slabs (PredefinedType ROOF or name indicating roof/cubierta/chapa grecada) to 'roof'
    if (
      cat === 'floor' &&
      e.type === 'IFCSLAB' &&
      (/ROOF|DACH|CUBIERTA|TEJADO|TECHO|AZOTEA|CHAPA\s*GRECADA|DECK/i.test(name) ||
        /ROOF/i.test(strVal(a[8] ?? '')))
    ) {
      cat = 'roof';
    }

    // Reclassify conceptual massing (Revit In-Place Mass / Mass Floors) to 'mass' so it is hidden by default
    const isMass =
      /^MASS(\s|:|_|\b)/i.test(name) ||
      /CONCEPTUAL\s*MASS|MASSING|DEFAULT\s*MASS\s*FLOOR/i.test(name) ||
      (info?.materials ?? []).some((m) => /default\s*form|mass/i.test(m));
    if (isMass) {
      cat = 'mass';
    }

    // ---- world-space geometry (oriented box when single extrusion, else AABB) ----
    let worldBox: Box | null = null;
    const placeId = refId(a[5] ?? '');
    const repId = refId(a[6] ?? '');
    const occWorld = placeId ? worldOfPlacement(placeId) : [...IDENT];
    let rotation: [number, number, number, number] | undefined;
    let oriented: { dims: Vec3; center: Vec3 } | null = null;
    if (repId) {
      const spec = extrusionSpec(repId, 0, new Set());
      if (spec) {
        const wf = mul(occWorld, spec.frame);
        const q = viewerQuat(wf);
        if (q) {
          rotation = q;
          oriented = { dims: spec.dims, center: xform(occWorld, spec.center) };
        }
      }
      for (const lb of localBoxes(repId)) {
        const corners: Vec3[] = [];
        for (let i = 0; i < 8; i++)
          corners.push(
            xform(occWorld, [
              i & 1 ? lb.max[0] : lb.min[0],
              i & 2 ? lb.max[1] : lb.min[1],
              i & 4 ? lb.max[2] : lb.min[2],
            ]),
          );
        const wb = boxOfPoints(corners);
        if (wb) worldBox = unionBox(worldBox, wb);
      }
    }

    // Skip empty aggregate containers whose components are already parsed
    if (!worldBox && !oriented && (e.type === 'IFCCURTAINWALL' || e.type === 'IFCSTAIR')) {
      continue;
    }

    if (worldBox) {
      geomResolved++;
      overallMin = overallMin
        ? [Math.min(overallMin[0], worldBox.min[0]), Math.min(overallMin[1], worldBox.min[1]), Math.min(overallMin[2], worldBox.min[2])]
        : [...worldBox.min] as Vec3;
      overallMax = overallMax
        ? [Math.max(overallMax[0], worldBox.max[0]), Math.max(overallMax[1], worldBox.max[1]), Math.max(overallMax[2], worldBox.max[2])]
        : [...worldBox.max] as Vec3;
    } else geomFallback++;

    // ---- area: quantities → overall dims → geometry face → unknown ----
    const area =
      q['netsidearea'] ?? q['grosssidearea'] ?? q['netarea'] ?? q['grossarea'] ??
      q['area'] ?? q['netvolume'] ?? null;
    let areaM2 = 0;
    let areaProv: Provenance = 'unknown';
    if (area !== null && Number.isFinite(area) && area > 0 && area * S * S < 1000000) {
      areaM2 = area * S * S; // quantities are in project length units
      areaProv = 'extracted';
    }
    if (areaProv === 'unknown' && (cat === 'door' || cat === 'window')) {
      // IfcDoor/IfcWindow carry OverallHeight/OverallWidth directly.
      const h = numVal(a[8] ?? '');
      const w = numVal(a[9] ?? '');
      if (h && w && h > 0 && w > 0 && h * S < 50 && w * S < 50) {
        areaM2 = h * S * w * S;
        areaProv = 'extracted';
      }
    }
    if (areaProv === 'unknown') {
      const L = q['length'] ?? q['overalllength'] ?? q['netlength'];
      const H = q['height'] ?? q['overallheight'] ?? q['netheight'] ?? q['width'] ?? q['overallwidth'];
      if (L && H && L > 0 && H > 0 && L * S < 500 && H * S < 100) {
        areaM2 = L * S * H * S;
        areaProv = 'derived';
      }
    }
    if (areaProv === 'unknown' && worldBox && cat !== 'structure') {
      const g = maxFaceArea(worldBox);
      if (g > 1e-6 && g < 1000000) {
        areaM2 = g;
        areaProv = 'derived';
      }
    }
    if (areaProv === 'unknown') areaM2 = 0;

    const mat = info?.materials?.[0];
    let matStandard: string | undefined;
    let uProv: Provenance = 'unknown';
    let uVal: number | undefined;
    if (info?.uValue !== undefined && Number.isFinite(info.uValue) && info.uValue > 0 && info.uValue < 10) {
      uVal = info.uValue;
      uProv = 'extracted';
      if (cat !== 'structure') uFound++;
    } else {
      const lookup = resolveMaterialUValue(mat, cat, name);
      if (lookup) {
        uVal = lookup.entry.uValueWm2K;
        uProv = 'derived';
        matStandard = lookup.entry.standard;
        if (cat !== 'structure') uFound++;
      } else if (cat !== 'structure') {
        uMissing++;
      }
    }

    let dims: BuildingElement['dims'];
    let center: BuildingElement['center'];
    if (oriented && rotation) {
      // Oriented box in the element's own swept-solid frame (IFC Z-up →
      // viewer Y-up on the way out).
      dims = {
        x: Math.max(oriented.dims[0], 0.02),
        y: Math.max(oriented.dims[2], 0.02),
        z: Math.max(oriented.dims[1], 0.02),
      };
      center = { x: oriented.center[0], y: oriented.center[2], z: oriented.center[1] };
    } else if (worldBox) {
      // IFC is Z-up; the Three.js viewer is Y-up — swap Y/Z (boxes are
      // symmetric, so handedness is irrelevant for the approximation).
      const d = boxDims(worldBox);
      dims = {
        x: Math.max(d[0], 0.02),
        y: Math.max(d[2], 0.02),
        z: Math.max(d[1], 0.02),
      };
      center = {
        x: (worldBox.min[0] + worldBox.max[0]) / 2,
        y: (worldBox.min[2] + worldBox.max[2]) / 2,
        z: (worldBox.min[1] + worldBox.max[1]) / 2,
      };
    } else {
      // Non-geometric element: do not create rogue visual boxes across the scene
      dims = undefined;
      center = undefined;
    }

    if (cat === 'structure') structureCount++;
    else {
      envelopeCount++;
      if (cat === 'floor' && areaM2 > 0) {
        const st = storeyOf.get(e.id) ?? '(unassigned)';
        slabAreasByStorey.set(st, (slabAreasByStorey.get(st) ?? 0) + areaM2);
      }
    }

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
      materialStandard: matStandard,
      dims,
      center,
      rotation,
      storey: storeyOf.get(e.id),
    });
    // Yield periodically for large files.
    if (idx % 2000 === 0) {
      onProgress?.({
        phase: `Extracting elements & geometry (${idx}/${items.length})`,
        fraction: 0.6 + (0.3 * idx) / Math.max(1, items.length),
      });
      await tick();
    }
  }

  if (envelopeCount === 0 && structureCount === 0) {
    throw new Error(
      'No envelope or structural elements (walls, windows, members, slabs, …) found in this file. It may be an MEP-only model or an unsupported IFC configuration.',
    );
  }
  const unknownAreas = elements.filter((e) => e.areaProvenance === 'unknown' && e.category !== 'structure').length;
  warnings.push(
    `${envelopeCount} envelope + ${structureCount} structural elements indexed from ${entities.length} IFC entities (${schema}).`,
  );
  if (structureCount > 0)
    warnings.push(
      'Structural parts (members, plates, beams, …) are shown in the viewer only and excluded from heat-loss calculations.',
    );
  warnings.push(
    unitUnresolved
      ? 'Project length unit could not be determined — assuming metres. Geometry scale may be wrong; check the viewer.'
      : `Project length unit: ${unitLabel} (scale ×${unitScale} applied to geometry and quantities).`,
  );
  warnings.push(
    `${geomResolved} elements placed from real IFC geometry (extrusions / mapped types / surface points); ${geomFallback} use fallback grid boxes.`,
  );
  if (clippedCount > 0)
    warnings.push(
      `${clippedCount} boolean-clipped solids rendered unclipped (openings/clippings approximated).`,
    );
  if (uFound === 0)
    warnings.push(
      'No thermal transmittance (U-values) found in property sets — defaults/assumptions will be used and are labelled as such.',
    );
  else warnings.push(`${uFound} elements carry extracted U-values; ${uMissing} use defaults.`);
  if (unknownAreas > 0)
    warnings.push(
      `${unknownAreas} envelope elements have no usable quantity or geometry — their area reads 0 and is excluded from heat-loss totals until quantities or manual values are supplied.`,
    );
  warnings.push('Viewer geometry is oriented bounding boxes from the model (not the original B-rep).');

  // Floor area / volume from slab geometry (footprint × height).
  const slabTotal = [...slabAreasByStorey.values()].reduce((a, b) => a + b, 0);
  const storeysWithSlabs = slabAreasByStorey.size || storeys.length || 1;
  const floorAreaM2 = slabTotal > 0 ? slabTotal : 200;
  const floorProv: Provenance = slabTotal > 0 ? 'derived' : 'assumption';
  if (slabTotal === 0) warnings.push('Floor area fallback of 200 m² assumed (no slab quantities or geometry).');
  const height =
    overallMin && overallMax ? Math.max(0.5, overallMax[2] - overallMin[2]) : 3.2;
  const footprint = slabTotal > 0 ? slabTotal / Math.max(1, storeysWithSlabs) : floorAreaM2;
  const volumeM3 = footprint * height;
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
    volumeProvenance: slabTotal > 0 && overallMin ? 'derived' : 'assumption',
    warnings,
    geometryFidelity: 'approximate',
  };
}

let ifcApiSingleton: WebIFC.IfcAPI | null = null;
let apiInitPromise: Promise<WebIFC.IfcAPI> | null = null;

async function getIfcApi(): Promise<WebIFC.IfcAPI> {
  if (ifcApiSingleton) return ifcApiSingleton;
  if (!apiInitPromise) {
    apiInitPromise = (async () => {
      const api = new WebIFC.IfcAPI();
      await api.Init((path: string) => {
        if (typeof window !== 'undefined') {
          return `/wasm/${path}`;
        }
        return path;
      });
      api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_ERROR);
      ifcApiSingleton = api;
      return api;
    })();
  }
  return apiInitPromise;
}

export async function parseIfcWithWebIfc(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: (p: IfcParseProgress) => void,
): Promise<BuildingModel> {
  onProgress?.({ phase: 'Initializing Web-IFC WebAssembly kernel', fraction: 0.1 });
  await tick();
  const ifcApi = await getIfcApi();

  onProgress?.({ phase: 'Opening IFC model', fraction: 0.25 });
  await tick();
  const modelID = ifcApi.OpenModel(bytes, {
    COORDINATE_TO_ORIGIN: false,
    ALLOW_INCOMPATIBLE_SCHEMA_ALIASES: true,
  });

  if (modelID < 0) {
    throw new Error('Web-IFC could not open model data.');
  }

  try {
    const schema = ifcApi.GetModelSchema(modelID) || 'IFC2X3';
    onProgress?.({ phase: 'Evaluating 3D geometry & boolean clippings', fraction: 0.45 });
    await tick();

    const meshMap = new Map<number, MeshGeometryData[]>();
    const elementBounds = new Map<number, { min: [number, number, number]; max: [number, number, number] }>();
    const elementMeshAreas = new Map<number, number>();

    let overallMin: [number, number, number] | null = null;
    let overallMax: [number, number, number] | null = null;

    ifcApi.StreamAllMeshes(modelID, (m) => {
      const geoms: MeshGeometryData[] = [];
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let totalTriArea = 0;

      for (let i = 0; i < m.geometries.size(); i++) {
        const g = m.geometries.get(i);
        const geomData = ifcApi.GetGeometry(modelID, g.geometryExpressID);
        const vArr = ifcApi.GetVertexArray(geomData.GetVertexData(), geomData.GetVertexDataSize());
        const iArr = ifcApi.GetIndexArray(geomData.GetIndexData(), geomData.GetIndexDataSize());

        const numV = vArr.length / 6;
        const positions = new Float32Array(numV * 3);
        const normals = new Float32Array(numV * 3);
        const tr = g.flatTransformation;

        for (let k = 0; k < numV; k++) {
          const vx = vArr[k * 6];
          const vy = vArr[k * 6 + 1];
          const vz = vArr[k * 6 + 2];

          // Apply transformation matrix (OpenGL column-major 4x4)
          const wx = tr[0] * vx + tr[4] * vy + tr[8] * vz + tr[12];
          const wy = tr[1] * vx + tr[5] * vy + tr[9] * vz + tr[13];
          const wz = tr[2] * vx + tr[6] * vy + tr[10] * vz + tr[14];

          positions[k * 3] = wx;
          positions[k * 3 + 1] = wy;
          positions[k * 3 + 2] = wz;

          // Normal rotation (3x3)
          const nx = vArr[k * 6 + 3];
          const ny = vArr[k * 6 + 4];
          const nz = vArr[k * 6 + 5];
          const rnx = tr[0] * nx + tr[4] * ny + tr[8] * nz;
          const rny = tr[1] * nx + tr[5] * ny + tr[9] * nz;
          const rnz = tr[2] * nx + tr[6] * ny + tr[10] * nz;
          const nl = Math.hypot(rnx, rny, rnz) || 1;

          normals[k * 3] = rnx / nl;
          normals[k * 3 + 1] = rny / nl;
          normals[k * 3 + 2] = rnz / nl;

          if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
          if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
          if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
        }

        const indices = new Uint32Array(iArr);

        for (let t = 0; t < indices.length; t += 3) {
          const i0 = indices[t] * 3;
          const i1 = indices[t + 1] * 3;
          const i2 = indices[t + 2] * 3;

          const ax = positions[i1] - positions[i0];
          const ay = positions[i1 + 1] - positions[i0 + 1];
          const az = positions[i1 + 2] - positions[i0 + 2];

          const bx = positions[i2] - positions[i0];
          const by = positions[i2 + 1] - positions[i0 + 1];
          const bz = positions[i2 + 2] - positions[i0 + 2];

          const cx = ay * bz - az * by;
          const cy = az * bx - ax * bz;
          const cz = ax * by - ay * bx;

          totalTriArea += 0.5 * Math.hypot(cx, cy, cz);
        }

        geoms.push({
          positions,
          normals,
          indices,
          color: [g.color.x, g.color.y, g.color.z, g.color.w],
        });
      }

      if (geoms.length > 0) {
        meshMap.set(m.expressID, geoms);
        elementBounds.set(m.expressID, { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
        elementMeshAreas.set(m.expressID, totalTriArea);

        if (!overallMin) {
          overallMin = [minX, minY, minZ];
          overallMax = [maxX, maxY, maxZ];
        } else {
          overallMin[0] = Math.min(overallMin[0], minX);
          overallMin[1] = Math.min(overallMin[1], minY);
          overallMin[2] = Math.min(overallMin[2], minZ);
          overallMax![0] = Math.max(overallMax![0], maxX);
          overallMax![1] = Math.max(overallMax![1], maxY);
          overallMax![2] = Math.max(overallMax![2], maxZ);
        }
      }
    });

    onProgress?.({ phase: 'Indexing properties & thermal metrics', fraction: 0.65 });
    await tick();

    // Fast Batch Property Extraction: avoids N*M recursive getPropertySets lookups (saving minutes/hangs)
    const thermalValByPropId = new Map<number, number>();
    const areaValByPropId = new Map<number, number>();
    const singleValIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCPROPERTYSINGLEVALUE, true);
    const numSingleVals = singleValIDs.size();
    for (let i = 0; i < numSingleVals; i++) {
      const id = singleValIDs.get(i);
      const line = ifcApi.GetLine(modelID, id, false);
      const name = String(line?.Name?.value || '');
      const val = line?.NominalValue?.value ?? line?.NominalValue?._representationValue;
      if (typeof val === 'number') {
        if (/thermal|uvalue|u_wert|transmittance/i.test(name) && val > 0 && val < 10) {
          thermalValByPropId.set(id, val);
        } else if (/area|flaeche|sidearea/i.test(name) && val > 0 && val < 100000) {
          areaValByPropId.set(id, val);
        }
      }
    }

    const thermalByPsetId = new Map<number, number>();
    const areaByPsetId = new Map<number, number>();
    const psetIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCPROPERTYSET, true);
    const numPsets = psetIDs.size();
    for (let i = 0; i < numPsets; i++) {
      const psetId = psetIDs.get(i);
      const pset = ifcApi.GetLine(modelID, psetId, false);
      const props = pset?.HasProperties;
      if (props && Array.isArray(props)) {
        for (const p of props) {
          const u = thermalValByPropId.get(p.value);
          if (u !== undefined && !thermalByPsetId.has(psetId)) thermalByPsetId.set(psetId, u);
          const a = areaValByPropId.get(p.value);
          if (a !== undefined && !areaByPsetId.has(psetId)) areaByPsetId.set(psetId, a);
        }
      }
    }

    // Check Element Quantities
    const qsetIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCELEMENTQUANTITY, true);
    const numQsets = qsetIDs.size();
    for (let i = 0; i < numQsets; i++) {
      const qsetId = qsetIDs.get(i);
      const qset = ifcApi.GetLine(modelID, qsetId, false);
      const quantities = qset?.Quantities;
      if (quantities && Array.isArray(quantities)) {
        for (const q of quantities) {
          const qLine = ifcApi.GetLine(modelID, q.value, false);
          const qName = String(qLine?.Name?.value || '');
          const val = qLine?.AreaValue?.value ?? qLine?.NetAreaValue?.value ?? qLine?.GrossAreaValue?.value ?? qLine?.LengthValue?.value;
          if (/area|sidearea|flaeche/i.test(qName) && typeof val === 'number' && val > 0 && val < 100000) {
            areaByPsetId.set(qsetId, val);
            break;
          }
        }
      }
    }

    // Map occurrences defined directly by property sets (IFCRELDEFINESBYPROPERTIES)
    const uValueByElem = new Map<number, number>();
    const areaByElem = new Map<number, number>();
    const relPropsIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES, true);
    const numRelProps = relPropsIDs.size();
    for (let i = 0; i < numRelProps; i++) {
      const rel = ifcApi.GetLine(modelID, relPropsIDs.get(i), false);
      const psetId = rel?.RelatingPropertyDefinition?.value;
      if (!psetId) continue;
      const u = thermalByPsetId.get(psetId);
      const a = areaByPsetId.get(psetId);
      if (u !== undefined || a !== undefined) {
        const related = rel.RelatedObjects;
        if (Array.isArray(related)) {
          for (const r of related) {
            if (u !== undefined && !uValueByElem.has(r.value)) uValueByElem.set(r.value, u);
            if (a !== undefined && !areaByElem.has(r.value)) areaByElem.set(r.value, a);
          }
        } else if (related) {
          if (u !== undefined && !uValueByElem.has(related.value)) uValueByElem.set(related.value, u);
          if (a !== undefined && !areaByElem.has(related.value)) areaByElem.set(related.value, a);
        }
      }
    }

    // Map types defined by property sets (IFCRELDEFINESBYTYPE)
    const thermalByType = new Map<number, number | null>();
    const areaByType = new Map<number, number | null>();
    const typeRelIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYTYPE, true);
    const numTypeRels = typeRelIDs.size();
    for (let i = 0; i < numTypeRels; i++) {
      const rel = ifcApi.GetLine(modelID, typeRelIDs.get(i), false);
      const typeId = rel?.RelatingType?.value;
      if (!typeId) continue;
      let typeU = thermalByType.get(typeId);
      let typeA = areaByType.get(typeId);
      if (typeU === undefined || typeA === undefined) {
        const typeObj = ifcApi.GetLine(modelID, typeId, false);
        const psets = typeObj?.HasPropertySets;
        if (psets && Array.isArray(psets)) {
          for (const ps of psets) {
            if (typeU === undefined) {
              const u = thermalByPsetId.get(ps.value);
              if (u !== undefined) typeU = u;
            }
            if (typeA === undefined) {
              const a = areaByPsetId.get(ps.value);
              if (a !== undefined) typeA = a;
            }
          }
        }
        thermalByType.set(typeId, typeU ?? null);
        areaByType.set(typeId, typeA ?? null);
      }
      const related = rel.RelatedObjects;
      if (Array.isArray(related)) {
        for (const r of related) {
          if (typeU && !uValueByElem.has(r.value)) uValueByElem.set(r.value, typeU);
          if (typeA && !areaByElem.has(r.value)) areaByElem.set(r.value, typeA);
        }
      } else if (related) {
        if (typeU && !uValueByElem.has(related.value)) uValueByElem.set(related.value, typeU);
        if (typeA && !areaByElem.has(related.value)) areaByElem.set(related.value, typeA);
      }
    }

    onProgress?.({ phase: 'Building spatial elements and geometry models', fraction: 0.85 });
    await tick();

    // Storeys
    const storeyIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCBUILDINGSTOREY, true);
    const storeys: string[] = [];
    for (let i = 0; i < storeyIDs.size(); i++) {
      const s = ifcApi.GetLine(modelID, storeyIDs.get(i));
      if (s?.Name?.value) storeys.push(s.Name.value);
    }

    // Spaces
    const spaceIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCSPACE, true);
    const spaceCount = spaceIDs.size();

    const elements: BuildingElement[] = [];
    let uFound = 0;
    let uMissing = 0;
    let totalFloorArea = 0;

    let processedCount = 0;
    const totalMeshes = meshMap.size;

    for (const [expressID, geoms] of meshMap.entries()) {
      processedCount++;
      if (processedCount % 5000 === 0) {
        onProgress?.({
          phase: `Building spatial elements (${processedCount}/${totalMeshes})`,
          fraction: 0.85 + (0.12 * processedCount) / Math.max(1, totalMeshes),
        });
        await tick();
      }

      const line = ifcApi.GetLine(modelID, expressID, false);
      const typeCode = ifcApi.GetLineType(modelID, expressID);
      const typeName = (ifcApi.GetNameFromTypeCode(typeCode) || '').toUpperCase();

      let cat: BuildingElement['category'] = 'other';
      if (/WALL/i.test(typeName)) cat = 'wall';
      else if (/WINDOW/i.test(typeName)) cat = 'window';
      else if (/DOOR/i.test(typeName)) cat = 'door';
      else if (/ROOF/i.test(typeName)) cat = 'roof';
      else if (/SLAB/i.test(typeName)) {
        const pType = String(line?.PredefinedType?.value || '').toUpperCase();
        const nameUpper = String(line?.Name?.value || '').toUpperCase();
        if (
          pType === 'ROOF' ||
          /ROOF|DACH|CUBIERTA|TEJADO|TECHO|AZOTEA|CHAPA\s*GRECADA|DECK/i.test(nameUpper)
        ) {
          cat = 'roof';
        } else {
          cat = 'floor';
        }
      } else if (/COLUMN|BEAM|MEMBER|PLATE|FOOTING|STAIR|RAMP|COVERING|PROXY/i.test(typeName)) {
        cat = 'structure';
      }

      // Reclassify transparent plates / glass panels
      if (cat === 'structure' && /PLATE/i.test(typeName)) {
        const nameUpper = String(line?.Name?.value || '').toUpperCase();
        if (/GLASS|VIDRIO|CRISTAL|GLAZ|PANEL/i.test(nameUpper)) {
          cat = 'window';
        }
      }

      // Reclassify conceptual massing (Revit In-Place Mass / Mass Floors / Helper proxies) to 'mass'
      const rawName = String(line?.Name?.value || '');
      const rawObjType = String(line?.ObjectType?.value || '');
      if (
        /^MASS(\s|:|_|\b)/i.test(rawName) ||
        /^MASS(\s|:|_|\b)/i.test(rawObjType) ||
        /CONCEPTUAL\s*MASS|MASSING|DEFAULT\s*MASS\s*FLOOR/i.test(rawName) ||
        /CONCEPTUAL\s*MASS|MASSING/i.test(rawObjType)
      ) {
        cat = 'mass';
      }

      const name = line?.Name?.value || `${typeName} #${expressID}`;
      const globalId = line?.GlobalId?.value || String(expressID);

      const uVal = uValueByElem.get(expressID);
      let areaM2 = areaByElem.get(expressID);
      let material: string | undefined;

      if (line?.ObjectType?.value && typeof line.ObjectType.value === 'string') {
        material = line.ObjectType.value;
      }

      const bounds = elementBounds.get(expressID);
      const bMin = bounds ? bounds.min : [0, 0, 0];
      const bMax = bounds ? bounds.max : [1, 1, 1];
      const dims = {
        x: Math.max(bMax[0] - bMin[0], 0.05),
        y: Math.max(bMax[1] - bMin[1], 0.05),
        z: Math.max(bMax[2] - bMin[2], 0.05),
      };
      const center = {
        x: (bMin[0] + bMax[0]) / 2,
        y: (bMin[1] + bMax[1]) / 2,
        z: (bMin[2] + bMax[2]) / 2,
      };

      const triArea = elementMeshAreas.get(expressID) || 0;
      let areaProv: Provenance = 'derived';
      if (areaM2 && areaM2 > 0) {
        areaProv = 'extracted';
      } else {
        areaM2 = triArea > 0 ? triArea / 2 : Math.max(dims.x * dims.y, dims.x * dims.z, dims.y * dims.z);
      }

      if (cat === 'floor') {
        totalFloorArea += areaM2;
      }

      let matStandard: string | undefined;
      let finalUVal: number | undefined = uVal;
      let uProv: Provenance = 'unknown';
      if (finalUVal !== undefined) {
        uProv = 'extracted';
        if (cat !== 'structure') uFound++;
      } else {
        const lookup = resolveMaterialUValue(material, cat, name);
        if (lookup) {
          finalUVal = lookup.entry.uValueWm2K;
          uProv = 'derived';
          matStandard = lookup.entry.standard;
          if (cat !== 'structure') uFound++;
        } else if (cat !== 'structure') {
          uMissing++;
        }
      }

      elements.push({
        id: String(expressID),
        globalId,
        ifcType: typeName,
        name,
        category: cat,
        areaM2: +areaM2.toFixed(2),
        areaProvenance: areaProv,
        uValueWm2K: finalUVal ? +finalUVal.toFixed(3) : undefined,
        uProvenance: uProv,
        material,
        materialProvenance: material ? 'extracted' : 'unknown',
        materialStandard: matStandard,
        dims,
        center,
        meshGeometries: geoms,
      });
    }

    if (elements.length === 0) {
      throw new Error('No envelope or structural elements found in IFC model.');
    }

    const height = overallMin && overallMax ? Math.max(0.5, overallMax[1] - overallMin[1]) : 3.2;
    const floorAreaM2 = totalFloorArea > 0 ? totalFloorArea : 200;
    const volumeM3 = floorAreaM2 * height;
    const projName = fileName.replace(/\.ifc$/i, '');

    const warnings: string[] = [
      `Parsed with Web-IFC high-fidelity WebAssembly geometry kernel.`,
      `${elements.length} elements evaluated with exact 3D triangulated B-Rep & boolean cuts.`,
    ];
    if (uFound > 0) warnings.push(`${uFound} elements carry extracted U-values; ${uMissing} use defaults.`);
    else warnings.push('No thermal transmittance (U-values) found in property sets — defaults/assumptions will be used.');

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
      floorAreaProvenance: totalFloorArea > 0 ? 'derived' : 'assumption',
      volumeM3: +volumeM3.toFixed(1),
      volumeProvenance: totalFloorArea > 0 ? 'derived' : 'assumption',
      warnings,
      geometryFidelity: 'actual',
    };
  } finally {
    ifcApi.CloseModel(modelID);
  }
}

export async function parseIfcBuffer(
  buffer: Uint8Array | ArrayBuffer,
  fileName: string,
  onProgress?: (p: IfcParseProgress) => void,
): Promise<BuildingModel> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    return await parseIfcWithWebIfc(bytes, fileName, onProgress);
  } catch (err) {
    // Only fall back to regex text parser for small snippets/test files (< 25MB).
    // Large models must not fall back to regex character scans which cause OOM and CPU thrashing.
    if (bytes.length < 25 * 1024 * 1024) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      return await parseIfcTextInternal(text, fileName, onProgress);
    }
    throw err;
  }
}

export async function parseIfcText(
  text: string,
  fileName: string,
  onProgress?: (p: IfcParseProgress) => void,
): Promise<BuildingModel> {
  // If text is a full IFC file, attempt web-ifc first
  if (text.includes('ISO-10303-21;') && text.length > 5000) {
    try {
      const bytes = new TextEncoder().encode(text);
      return await parseIfcWithWebIfc(bytes, fileName, onProgress);
    } catch (err) {
      if (text.length > 25 * 1024 * 1024) throw err;
    }
  }
  return await parseIfcTextInternal(text, fileName, onProgress);
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
  if (file.size === 0) return 'File is empty.';
  return null;
}
