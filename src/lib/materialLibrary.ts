/**
 * Official Architectural Material Library (ISO 10456 / ISO 10077-1 / ASHRAE 90.1)
 *
 * Provides standardized design thermal transmittances (U-values in W/m²K)
 * and material identification for BIM elements when explicit PropertySet
 * values (ThermalTransmittance) are omitted from the IFC model.
 */

import type { ElementCategory } from './types';

export interface MaterialStandardEntry {
  id: string;
  name: string;
  category: ElementCategory;
  uValueWm2K: number;
  standard: 'ISO 10456' | 'ISO 10077-1' | 'EN 673' | 'ASHRAE 90.1' | 'ISO 13370';
  description: string;
  keywords: string[];
}

/**
 * Standard tabulated thermal transmittances for architectural constructions.
 * Values derived from ISO 10456:2007 (Table 3), ISO 10077-1 (Table F.1-F.4),
 * EN 673 (glazing), and ASHRAE Handbook of Fundamentals.
 */
export const OFFICIAL_MATERIAL_LIBRARY: MaterialStandardEntry[] = [
  // --- GLAZING & WINDOWS (ISO 10077-1 / EN 673 / ASHRAE 90.1) ---
  {
    id: 'glaz-triple-low-e',
    name: 'Triple Glazing (Low-E, Argon)',
    category: 'window',
    uValueWm2K: 0.70,
    standard: 'EN 673',
    description: 'Triple pane insulated glass unit with 2 low-emissivity coatings and 90% argon gas fill.',
    keywords: ['triple glazing', 'triple glazed', 'triple pane', 'triple-pane', 'triple glass', 'triple', '3-pane', 'dreifach', '3-fach', 'triplex'],
  },
  {
    id: 'glaz-vacuum',
    name: 'Vacuum Insulated Glazing (VIG)',
    category: 'window',
    uValueWm2K: 0.50,
    standard: 'ISO 10077-1',
    description: 'High-performance vacuum glass with micro-spacers and low-E coatings.',
    keywords: ['vacuum', 'vig', 'vakuum'],
  },
  {
    id: 'glaz-double-low-e',
    name: 'Double Glazing (Low-E, Argon)',
    category: 'window',
    uValueWm2K: 1.30,
    standard: 'EN 673',
    description: 'Double pane insulated unit (4-16-4) with soft-coat low-E and argon fill.',
    keywords: ['low-e', 'lowe', 'low e', 'argon', 'krypton', 'warm edge', 'thermo', 'isover', 'sunergy', 'planitherm'],
  },
  {
    id: 'glaz-double-clear',
    name: 'Double Glazing (Standard Clear)',
    category: 'window',
    uValueWm2K: 2.70,
    standard: 'ISO 10077-1',
    description: 'Double pane unit with standard clear float glass and air cavity.',
    keywords: ['double', 'double pane', 'double-pane', 'igu', 'zweifach', '2-fach', 'insulating glass', 'isoglas'],
  },
  {
    id: 'glaz-polycarb',
    name: 'Multiwall Polycarbonate Glazing',
    category: 'window',
    uValueWm2K: 2.20,
    standard: 'ISO 10077-1',
    description: 'Multi-chamber translucent polycarbonate sheet (16-25mm).',
    keywords: ['polycarbonate', 'polycarb', 'danpalon', 'lexan', 'makrolon', 'multiwall', 'steghohlplatte'],
  },
  {
    id: 'glaz-curtain-wall',
    name: 'Curtain Wall Glazing Assembly',
    category: 'window',
    uValueWm2K: 1.40,
    standard: 'ISO 10077-1',
    description: 'Thermally broken aluminum mullion/transom curtain wall with double low-E units.',
    keywords: ['curtain wall', 'curtainwall', 'fassade', 'cw', 'pfosten', 'mullion', 'transom', 'storefront'],
  },
  {
    id: 'glaz-single',
    name: 'Single Glazing (Float Glass)',
    category: 'window',
    uValueWm2K: 5.80,
    standard: 'ISO 10077-1',
    description: 'Single monolithic clear float or laminated glass sheet.',
    keywords: ['single glazing', 'single glazed', 'single pane', 'single-pane', 'monolithic', 'float glass', 'einfachglas', 'flachglas', 'single'],
  },
  {
    id: 'glaz-generic-double',
    name: 'Standard Insulated Glazing',
    category: 'window',
    uValueWm2K: 1.40,
    standard: 'ISO 10077-1',
    description: 'Standard modern double-glazed window assembly.',
    keywords: ['glazing', 'glass', 'fenster', 'window', 'vitrage'],
  },

  // --- WALLS & OPAQUE ENVELOPE (ISO 10456:2007) ---
  {
    id: 'wall-sip',
    name: 'Structural Insulated Panel (SIP)',
    category: 'wall',
    uValueWm2K: 0.16,
    standard: 'ISO 10456',
    description: 'High-performance sandwich panel with 150mm EPS/PUR core between OSB facings.',
    keywords: ['sip', 'structural insulated', 'sandwich panel', 'sandwichpanel', 'panneau sandwich'],
  },
  {
    id: 'wall-timber-frame-insulated',
    name: 'Insulated Timber Frame Wall',
    category: 'wall',
    uValueWm2K: 0.22,
    standard: 'ISO 10456',
    description: 'Lightweight timber stud wall with 140mm mineral wool + continuous external insulation.',
    keywords: ['timber frame', 'wood frame', 'holzrahmen', 'holzständer', 'stud wall', 'timber stud', 'holzbau'],
  },
  {
    id: 'wall-clt-insulated',
    name: 'Cross-Laminated Timber (CLT Insulated)',
    category: 'wall',
    uValueWm2K: 0.24,
    standard: 'ISO 10456',
    description: '100mm 5-ply CLT solid wood wall with 120mm external wood fiber / mineral wool.',
    keywords: ['clt', 'cross-laminated', 'cross laminated', 'massivholz', 'brettsperrholz'],
  },
  {
    id: 'wall-cavity-brick-insulated',
    name: 'Insulated Cavity Brick / Masonry',
    category: 'wall',
    uValueWm2K: 0.30,
    standard: 'ISO 10456',
    description: 'Outer brick veneer, cavity with 100mm mineral wool insulation, and inner clay block/CMU.',
    keywords: ['cavity', 'brick', 'masonry', 'mauerwerk', 'ziegel', 'klinker', 'blockwork', 'cmu', 'clay brick'],
  },
  {
    id: 'wall-concrete-insulated',
    name: 'Insulated Concrete Wall (EIFS / Sandwich)',
    category: 'wall',
    uValueWm2K: 0.32,
    standard: 'ISO 10456',
    description: 'Reinforced concrete structure with 120mm external thermal insulation composite system (ETICS).',
    keywords: ['reinforced concrete', 'precast', 'sandwich', 'etics', 'eifs', 'wdvs', 'betonwand', 'precast concrete'],
  },
  {
    id: 'wall-aac',
    name: 'Autoclaved Aerated Concrete (AAC / Hebel)',
    category: 'wall',
    uValueWm2K: 0.28,
    standard: 'ISO 10456',
    description: '365mm monolithic aerated concrete blockwork without additional synthetic insulation.',
    keywords: ['aac', 'aerated concrete', 'hebel', 'ytong', 'porenbeton', 'gasbeton'],
  },
  {
    id: 'wall-spandrel',
    name: 'Insulated Curtain Wall Spandrel',
    category: 'wall',
    uValueWm2K: 0.45,
    standard: 'ASHRAE 90.1',
    description: 'Opaque spandrel glass panel backed with 100mm foil-faced mineral wool insulation.',
    keywords: ['spandrel', 'paneel', 'brüstung', 'curtain wall spandrel'],
  },
  {
    id: 'wall-stone-clad',
    name: 'Natural Stone Clad Insulated Wall',
    category: 'wall',
    uValueWm2K: 0.35,
    standard: 'ISO 10456',
    description: 'Ventilated natural stone / granite rainscreen with 120mm mineral wool sub-framing.',
    keywords: ['stone', 'granite', 'limestone', 'sandstone', 'travertine', 'naturstein', 'kalkstein'],
  },
  {
    id: 'wall-solid-brick-uninsulated',
    name: 'Solid Brick Wall (Uninsulated Heritage)',
    category: 'wall',
    uValueWm2K: 1.80,
    standard: 'ISO 10456',
    description: 'Uninsulated solid masonry / historical brick wall (215mm-330mm).',
    keywords: ['solid brick', 'uninsulated', 'vollziegel', 'altbau'],
  },
  {
    id: 'wall-concrete-uninsulated',
    name: 'Solid Concrete Wall (Uninsulated)',
    category: 'wall',
    uValueWm2K: 2.30,
    standard: 'ISO 10456',
    description: 'Uninsulated 200mm cast-in-place structural concrete core / retaining wall.',
    keywords: ['concrete', 'beton', 'retaining wall', 'shear wall', 'kernwand'],
  },
  {
    id: 'wall-generic-standard',
    name: 'Standard Insulated Wall Assembly',
    category: 'wall',
    uValueWm2K: 0.35,
    standard: 'ISO 10456',
    description: 'General regulatory baseline external wall construction.',
    keywords: ['wall', 'wand', 'mur', 'partition', 'envelope'],
  },

  // --- ROOFS & ATTICS (ISO 10456:2007) ---
  {
    id: 'roof-green-vegetated',
    name: 'Extensive Green Roof (Sedum)',
    category: 'roof',
    uValueWm2K: 0.20,
    standard: 'ISO 10456',
    description: 'Concrete deck with 140mm PIR insulation, drainage layer, and 100mm sedum substrate.',
    keywords: ['green roof', 'sedum', 'vegetated', 'gründach', 'roof garden', 'dachbegrünung'],
  },
  {
    id: 'roof-pitched-insulated',
    name: 'Insulated Pitched Roof (Rafters)',
    category: 'roof',
    uValueWm2K: 0.18,
    standard: 'ISO 10456',
    description: 'Timber rafter roof with tile/slate covering and 200mm between-and-under rafter mineral wool.',
    keywords: ['pitched roof', 'rafter', 'steildach', 'sparrendach', 'shingle', 'tile roof', 'slate', 'ziegeldach'],
  },
  {
    id: 'roof-flat-warm',
    name: 'Insulated Warm Flat Roof',
    category: 'roof',
    uValueWm2K: 0.20,
    standard: 'ISO 10456',
    description: 'Reinforced concrete / metal deck flat roof with 140mm PIR insulation and waterproof membrane.',
    keywords: ['flat roof', 'warm roof', 'flachdach', 'concrete roof', 'deck', 'membrane', 'bitumen', 'epdm', 'tpo'],
  },
  {
    id: 'roof-metal-insulated',
    name: 'Insulated Metal Standing Seam Roof',
    category: 'roof',
    uValueWm2K: 0.22,
    standard: 'ISO 10456',
    description: 'Standing seam zinc / aluminum sheet roof with 160mm continuous insulation.',
    keywords: ['metal roof', 'standing seam', 'stefalz', 'blechdach', 'corrugated', 'trapezoid'],
  },
  {
    id: 'roof-generic-standard',
    name: 'Standard Insulated Roof Assembly',
    category: 'roof',
    uValueWm2K: 0.25,
    standard: 'ISO 10456',
    description: 'General regulatory baseline insulated roof construction.',
    keywords: ['roof', 'dach', 'toit', 'attic', 'ceiling'],
  },

  // --- FLOORS & GROUND SLABS (ISO 13370 / ISO 10456) ---
  {
    id: 'floor-ground-insulated',
    name: 'Ground-Bearing Insulated Concrete Slab',
    category: 'floor',
    uValueWm2K: 0.30,
    standard: 'ISO 13370',
    description: 'Ground-bearing 150mm concrete slab with 100mm EPS/XPS under-slab insulation.',
    keywords: ['ground-bearing', 'ground slab', 'slab-on-grade', 'bodenplatte', 'fundament', 'perimeterschutz', 'under-slab'],
  },
  {
    id: 'floor-suspended-timber',
    name: 'Insulated Suspended Timber Floor',
    category: 'floor',
    uValueWm2K: 0.25,
    standard: 'ISO 13370',
    description: 'Suspended wooden joist ground floor with 150mm insulation quilt over ventilated void.',
    keywords: ['suspended floor', 'joist', 'holzbalkendecke', 'kriechgang', 'crawl space'],
  },
  {
    id: 'floor-uninsulated-ground',
    name: 'Uninsulated Concrete Ground Slab',
    category: 'floor',
    uValueWm2K: 0.85,
    standard: 'ISO 13370',
    description: 'Direct cast uninsulated concrete slab on hardcore ground.',
    keywords: ['uninsulated slab', 'hardcore', 'raw slab'],
  },
  {
    id: 'floor-generic-standard',
    name: 'Standard Ground Slab Construction',
    category: 'floor',
    uValueWm2K: 0.40,
    standard: 'ISO 13370',
    description: 'Standard baseline ground floor slab.',
    keywords: ['floor', 'slab', 'boden', 'dalle', 'plancher'],
  },

  // --- DOORS & ENTRANCES (ISO 10077-1 / ASHRAE 90.1) ---
  {
    id: 'door-composite-insulated',
    name: 'Insulated Composite Entrance Door',
    category: 'door',
    uValueWm2K: 1.20,
    standard: 'ISO 10077-1',
    description: 'Thermally insulated polyurethane core composite entrance door with multi-point gasket.',
    keywords: ['composite door', 'insulated door', 'haustür', 'eingangstür', 'security door', 'thermal door'],
  },
  {
    id: 'door-glazed-terrace',
    name: 'Glazed Patio / Terrace Door',
    category: 'door',
    uValueWm2K: 1.50,
    standard: 'ISO 10077-1',
    description: 'Thermally broken frame sliding or hinged terrace glass door with double low-E glazing.',
    keywords: ['glazed door', 'glass door', 'sliding door', 'french door', 'patio door', 'hebe-schiebetür', 'balkontür'],
  },
  {
    id: 'door-timber-solid',
    name: 'Solid Hardwood / Timber Door',
    category: 'door',
    uValueWm2K: 1.80,
    standard: 'ISO 10077-1',
    description: 'Solid 44-54mm timber exterior door panel without synthetic core.',
    keywords: ['wood door', 'timber door', 'holztür', 'solid wood', 'hardwood'],
  },
  {
    id: 'door-revolving-automatic',
    name: 'Commercial Revolving / Automatic Door',
    category: 'door',
    uValueWm2K: 2.20,
    standard: 'ASHRAE 90.1',
    description: 'Commercial glass revolving entrance or bi-parting sliding entrance.',
    keywords: ['revolving', 'automatic door', 'drehtür', 'automatiktür', 'vestibule'],
  },
  {
    id: 'door-metal-uninsulated',
    name: 'Uninsulated Metal / Steel Utility Door',
    category: 'door',
    uValueWm2K: 3.00,
    standard: 'ASHRAE 90.1',
    description: 'Hollow metal or single skin steel service / fire exit door.',
    keywords: ['metal door', 'steel door', 'stahltür', 'blechtür', 'fire door', 'utility door'],
  },
  {
    id: 'door-generic-standard',
    name: 'Standard Exterior Door',
    category: 'door',
    uValueWm2K: 2.20,
    standard: 'ISO 10077-1',
    description: 'Standard baseline exterior door.',
    keywords: ['door', 'tür', 'porte', 'entrance'],
  },
];

export interface MaterialLookupResult {
  entry: MaterialStandardEntry;
  confidence: 'high' | 'medium' | 'fallback';
  matchedQuery: string;
}

const GENERIC_CATEGORY_TERMS = new Set([
  'glazing', 'glass', 'fenster', 'window', 'vitrage',
  'wall', 'wand', 'mur', 'partition', 'envelope',
  'roof', 'dach', 'toit', 'attic', 'ceiling',
  'floor', 'slab', 'boden', 'dalle', 'plancher',
  'door', 'tür', 'porte', 'entrance',
]);

/**
 * Searches the official material library using material names, element names, and category.
 * Scores matches based on category alignment and keyword specificity.
 */
export function resolveMaterialUValue(
  materialName?: string,
  category?: ElementCategory,
  elementName?: string
): MaterialLookupResult | null {
  const text = `${materialName || ''} ${elementName || ''}`.toLowerCase().trim();
  if (!text) return null;

  // Filter candidates: prefer candidates matching the element's category if known
  const categoryCandidates = category
    ? OFFICIAL_MATERIAL_LIBRARY.filter((e) => e.category === category)
    : OFFICIAL_MATERIAL_LIBRARY;

  let bestMatch: MaterialStandardEntry | null = null;
  let bestScore = 0;
  let bestConfidence: 'high' | 'medium' | 'fallback' = 'fallback';

  for (const entry of categoryCandidates) {
    let entryScore = 0;
    for (const kw of entry.keywords) {
      const kwLower = kw.toLowerCase();
      if (text.includes(kwLower)) {
        if (GENERIC_CATEGORY_TERMS.has(kwLower)) {
          entryScore += 0.5;
        } else {
          const isMultiWord = kwLower.includes(' ') || kwLower.includes('-');
          entryScore += kwLower.length * (isMultiWord ? 4 : 2) + 10;
        }
      }
    }
    if (text.includes(entry.name.toLowerCase())) {
      entryScore += 30;
    }
    if (entryScore > bestScore) {
      bestScore = entryScore;
      bestMatch = entry;
      bestConfidence = entryScore >= 12 ? 'high' : 'medium';
    }
  }

  // If no match found within the specific category, search across the entire library
  if (!bestMatch && category) {
    for (const entry of OFFICIAL_MATERIAL_LIBRARY) {
      let entryScore = 0;
      for (const kw of entry.keywords) {
        const kwLower = kw.toLowerCase();
        if (text.includes(kwLower)) {
          if (GENERIC_CATEGORY_TERMS.has(kwLower)) {
            entryScore += 0.2;
          } else {
            const isMultiWord = kwLower.includes(' ') || kwLower.includes('-');
            entryScore += kwLower.length * (isMultiWord ? 3 : 1.5) + 5;
          }
        }
      }
      if (entryScore > bestScore) {
        bestScore = entryScore;
        bestMatch = entry;
        bestConfidence = 'medium';
      }
    }
  }

  if (!bestMatch) return null;

  return {
    entry: bestMatch,
    confidence: bestConfidence,
    matchedQuery: text,
  };
}
