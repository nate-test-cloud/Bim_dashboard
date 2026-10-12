/**
 * Shared domain types for the BIM Sustainability Analytics app.
 *
 * Provenance model — every envelope-relevant value carries a source label:
 *  - "extracted": parsed from the uploaded IFC/model file
 *  - "derived": computed from model geometry (e.g. WWR from areas)
 *  - "user": manually entered or adjusted via controls
 *  - "assumption": built-in default used because nothing better exists
 *  - "unknown": could not be determined
 */

export type Provenance =
  | 'extracted'
  | 'derived'
  | 'user'
  | 'assumption'
  | 'unknown';

export interface ProvValue<T = number> {
  value: T;
  provenance: Provenance;
  note?: string;
}

export type ElementCategory =
  | 'wall'
  | 'window'
  | 'door'
  | 'roof'
  | 'floor'
  | 'structure' // members, plates, beams, columns… viewer-only, excluded from heat math
  | 'storey'
  | 'space'
  | 'other';

export interface BuildingElement {
  id: string;
  globalId?: string;
  ifcType?: string;
  name: string;
  category: ElementCategory;
  /** Envelope-relevant surface area in m² (one-sided). */
  areaM2: number;
  areaProvenance: Provenance;
  uValueWm2K?: number;
  uProvenance?: Provenance;
  material?: string;
  materialProvenance?: Provenance;
  /** Approximate box dims (m) used to draw the element in the 3D viewer. */
  dims?: { x: number; y: number; z: number };
  center?: { x: number; y: number; z: number };
  /**
   * Optional viewer orientation as quaternion [x,y,z,w]. When present, dims
   * are the oriented (local-frame) sizes and the box is rotated by this
   * quaternion; when absent the box is axis-aligned. Derived from the
   * element's own swept-solid frame — still an approximation, not the B-rep.
   */
  rotation?: [number, number, number, number];
  storey?: string;
}

export interface BuildingModel {
  name: string;
  source: 'sample' | 'demo-tower' | 'ifc' | 'json';
  sourceFileName?: string;
  schema?: string;
  storeys: string[];
  spaces: number;
  elements: BuildingElement[];
  floorAreaM2: number;
  floorAreaProvenance: Provenance;
  volumeM3: number;
  volumeProvenance: Provenance;
  warnings: string[];
  /** True when geometry is a real imported shape vs an approximation. */
  geometryFidelity: 'actual' | 'approximate' | 'sample';
}

export interface EnvelopeSummary {
  wallArea: number;
  windowArea: number;
  roofArea: number;
  floorArea: number;
  doorArea: number;
  totalExterior: number;
  wwr: number; // window / (wall+window), 0..1
  wwrProvenance: Provenance;
}

export interface EnvInputs {
  outdoorTempC: number;
  solarIrradianceWm2: number; // user-supplied incident irradiance, used directly
  cloudCoverPct: number; // informational; NOT applied as multiplier (see docs)
  windSpeedMs: number;
  relHumidityPct: number;
  indoorSetpointC: number;
  analysisDate: string; // ISO date string for reference
}

export interface DesignInputs {
  wallU: ProvValue;
  roofU: ProvValue;
  glazingU: ProvValue;
  shgc: ProvValue; // 0..1
  shadingFactor: ProvValue; // fraction of solar transmitted after shading, 0..1
  wwr: ProvValue; // 0..0.9 target applied to glazing area scaling
  orientationDeg: number; // building rotation, informational for passive-solar notes
  infiltrationACH: number;
  internalGainsWm2: number;
  ventilationOpenableFraction: number; // 0..1 of glazing openable
  greenRoofFraction: number; // 0..1 of roof greened
  greenWallFraction: number; // 0..1 of wall greened
  naturalVentilationOn: boolean;
  euiTargetKwhM2Yr: number;
  carbonFactorKgPerKwh: number;
  equivHeatingHours: number; // for illustrative annualization
  equivCoolingHours: number;
}

export interface CalcComponent {
  key: string;
  label: string;
  areaM2: number;
  uValue: number;
  qW: number; // signed: + = heat loss (out of building), − = heat gain
}

export interface CalcResults {
  mode: 'analytical-demo';
  deltaTK: number;
  components: CalcComponent[];
  transmissionTotalW: number;
  solarGainW: number;
  internalGainsW: number;
  ventilationW: number; // signed like transmission (+ = loss)
  heatingLoadW: number;
  coolingLoadW: number;
  activeMode: 'heating' | 'cooling' | 'neutral';
  operativeTempFreeC: number; // free-running steady-state estimate
  operativeTempMaintainedC: number; // ≈ setpoint when HVAC active
  comfortStatus: 'comfortable' | 'slightly-warm' | 'warm' | 'hot' | 'slightly-cool' | 'cool' | 'cold';
  daylightPotentialPct: number; // 0..100, explicitly NOT validated DA
  euiIllustrative: number | null; // kWh/m²/yr or null when not annualizable
  annualEnergyKwh: number | null;
  carbonKgPerYr: number | null;
  natVentPotential: 'high' | 'moderate' | 'low' | 'none';
  natVentNote: string;
  transmissionByComponent: { label: string; valueW: number }[];
  warnings: string[];
}

export interface Scenario {
  id: string;
  name: string;
  env: EnvInputs;
  design: DesignInputs;
  createdAt: string;
  note?: string;
}

export interface MonthlyRow {
  month: string;
  tAvgC: number;
  solarWm2: number;
  heatingKwh: number;
  coolingKwh: number;
}

export interface IntegrationStatus {
  name: string;
  status: 'not-configured' | 'unavailable' | 'connected';
  detail: string;
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  extracted: 'Extracted from BIM',
  derived: 'Derived from geometry',
  user: 'User-supplied',
  assumption: 'Assumption (default)',
  unknown: 'Unknown',
};
