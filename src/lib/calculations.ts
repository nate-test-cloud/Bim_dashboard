/**
 * Analytical / demo calculation engine.
 * ---------------------------------------------------------------------------
 * All functions are pure, documented, unit-tested, and operate in SI units.
 *
 * METHOD
 *  1. Envelope transmission (steady-state, per component):
 *       Q = U · A · ΔT,  ΔT = T_in,set − T_out  [W]
 *     Sign convention: Q > 0 means heat flows OUT of the building
 *     (fabric heat loss, winter condition). Q < 0 means heat flows in.
 *  2. Solar gain through glazing (single explicit step, no double counting):
 *       Q_sol = G · A_glaz · SHGC · f_shade  [W]
 *     G is the user-supplied incident irradiance (W/m²). Cloud cover is
 *     informational only and is NEVER silently applied as a multiplier.
 *  3. Ventilation / infiltration:
 *       H_ve = 0.33 · ACH · V   [W/K]   (ρ·cp of air ≈ 1200 J/m³K / 3600)
 *       Q_ve = H_ve · ΔT        [W]     (same sign convention as above)
 *     When natural ventilation is enabled AND outdoor air can provide free
 *     cooling (16 °C ≤ T_out ≤ T_set and wind > 0.5 m/s), the mechanical load
 *     is reduced by a disclosed factor of up to 40%.
 *  4. Heat balance at the indoor setpoint:
 *       Q_hvac = (Q_tr + Q_ve) − Q_sol − Q_int
 *     Q_hvac > 0 → heating load; Q_hvac < 0 → cooling load (|Q|).
 *  5. Free-running operative temperature (no HVAC, steady state):
 *       T_free = T_out + (Q_sol + Q_int) / (H_tr + H_ve)
 *     where H_tr = Σ U·A. This is a coarse single-node estimate, disclosed
 *     as such; it is NOT a validated thermal simulation.
 *  6. Daylight potential index (explicitly NOT Daylight Autonomy):
 *       DPI = clamp( (G/1000) · τ_vis · k_geo ) with τ_vis ≈ SHGC·1.15
 *     capped at 1, expressed as %. DA requires annual climate-based
 *     simulation (Radiance); we do not claim that here.
 *  7. Illustrative EUI annualization (clearly labelled estimate only):
 *       E_ann = P_heat·h_heat + P_cool·h_cool   [kWh]
 *       EUI   = E_ann / floorArea
 *     using user-configurable equivalent full-load hours. Displayed as
 *     "illustrative" whenever monthly simulation data is absent.
 *
 * LIMITS: single thermal zone, steady-state, no thermal mass, no
 * solar-position geometry, no HVAC efficiency curves, no validated airflow
 * network. Results are suitable for design-direction comparison, not for
 * code compliance or equipment sizing.
 */

import type {
  BuildingModel,
  CalcResults,
  DesignInputs,
  EnvelopeSummary,
  EnvInputs,
} from './types';

export function summarizeEnvelope(model: BuildingModel): EnvelopeSummary {
  const sum = (cat: string) =>
    model.elements
      .filter((e) => e.category === cat)
      .reduce((a, e) => a + (Number.isFinite(e.areaM2) ? e.areaM2 : 0), 0);
  const wallArea = sum('wall');
  const windowArea = sum('window');
  const roofArea = sum('roof');
  const floorArea = sum('floor');
  const doorArea = sum('door');
  const totalExterior = wallArea + windowArea + roofArea + doorArea;
  const denom = wallArea + windowArea;
  const wwr = denom > 0 ? windowArea / denom : 0;
  return {
    wallArea,
    windowArea,
    roofArea,
    floorArea,
    doorArea,
    totalExterior,
    wwr,
    wwrProvenance: 'derived',
  };
}

/** Effective glazing area after applying the user's target WWR to opaque+glazing wall band. */
export function scaledGlazingArea(
  summary: EnvelopeSummary,
  targetWwr: number,
): { glazingM2: number; opaqueWallM2: number } {
  const band = summary.wallArea + summary.windowArea;
  const w = Math.min(0.9, Math.max(0.02, targetWwr));
  const glazingM2 = band * w;
  const opaqueWallM2 = band * (1 - w);
  return { glazingM2, opaqueWallM2 };
}

export interface HeatBalanceInputs {
  areas: { wallM2: number; roofM2: number; glazingM2: number; doorM2?: number };
  uValues: { wallU: number; roofU: number; glazingU: number; doorU?: number };
  env: EnvInputs;
  design: DesignInputs;
  volumeM3: number;
  floorAreaM2: number;
}

export function heatBalance(i: HeatBalanceInputs): CalcResults {
  const warnings: string[] = [];
  const dT = i.env.indoorSetpointC - i.env.outdoorTempC;

  const comps = [
    {
      key: 'wall',
      label: 'Walls',
      areaM2: i.areas.wallM2,
      uValue: i.uValues.wallU,
      qW: i.uValues.wallU * i.areas.wallM2 * dT,
    },
    {
      key: 'roof',
      label: 'Roof',
      areaM2: i.areas.roofM2,
      uValue: i.uValues.roofU,
      qW: i.uValues.roofU * i.areas.roofM2 * dT,
    },
    {
      key: 'glazing',
      label: 'Windows (conduction)',
      areaM2: i.areas.glazingM2,
      uValue: i.uValues.glazingU,
      qW: i.uValues.glazingU * i.areas.glazingM2 * dT,
    },
  ];
  if ((i.areas.doorM2 ?? 0) > 0) {
    const doorU = i.uValues.doorU ?? 2.2;
    comps.push({
      key: 'door',
      label: 'Doors',
      areaM2: i.areas.doorM2 ?? 0,
      uValue: doorU,
      qW: doorU * (i.areas.doorM2 ?? 0) * dT,
    });
  }
  const transmissionTotalW = comps.reduce((a, c) => a + c.qW, 0);

  // Solar gain — uses supplied irradiance directly (no hidden cloud factor).
  const G = Math.max(0, i.env.solarIrradianceWm2);
  const solarGainW =
    G * i.areas.glazingM2 * clamp01(i.design.shgc.value) * clamp01(i.design.shadingFactor.value);

  const internalGainsW = Math.max(0, i.design.internalGainsWm2) * Math.max(1, i.floorAreaM2);

  const ach = Math.max(0, i.design.infiltrationACH);
  const hVe = 0.33 * ach * Math.max(1, i.volumeM3);
  const ventilationW = hVe * dT;

  let qHvac = transmissionTotalW + ventilationW - solarGainW - internalGainsW;

  // Natural-ventilation free-cooling credit (disclosed approximation).
  let nvCredit = 0;
  const tOut = i.env.outdoorTempC;
  const canFreeCool =
    i.design.naturalVentilationOn &&
    tOut >= 16 &&
    tOut <= i.env.indoorSetpointC &&
    i.env.windSpeedMs > 0.5;
  if (canFreeCool && qHvac < 0) {
    nvCredit = Math.min(0.4, 0.1 + 0.1 * i.env.windSpeedMs * i.design.ventilationOpenableFraction * 4);
    qHvac = qHvac * (1 - nvCredit);
  }

  const heatingLoadW = qHvac > 0 ? qHvac : 0;
  const coolingLoadW = qHvac < 0 ? -qHvac : 0;
  const activeMode = heatingLoadW > 5 ? 'heating' : coolingLoadW > 5 ? 'cooling' : 'neutral';

  // Free-running operative temperature.
  const hTr = comps.reduce((a, c) => a + c.uValue * c.areaM2, 0);
  const hTot = hTr + hVe;
  const operativeTempFreeC = hTot > 1 ? tOut + (solarGainW + internalGainsW) / hTot : tOut;
  const operativeTempMaintainedC =
    activeMode === 'neutral'
      ? operativeTempFreeC
      : i.env.indoorSetpointC + (qHvac > 0 ? -0.2 : 0.4);

  const comfortStatus = classifyComfort(operativeTempMaintainedC);

  // Daylight potential index — explicitly not DA.
  const tauVis = Math.min(0.9, clamp01(i.design.shgc.value) * 1.15);
  const kGeo = Math.min(1, 0.25 + scaledWwrFactor(i.areas.glazingM2, i.floorAreaM2));
  const daylightPotentialPct =
    Math.round(Math.min(1, (G / 1000) * tauVis * 2.2 * kGeo + (G > 50 ? 0.12 : 0)) * 100);

  // Illustrative annualization.
  const annualEnergyKwh =
    (heatingLoadW * Math.max(0, i.design.equivHeatingHours) +
      coolingLoadW * Math.max(0, i.design.equivCoolingHours)) /
    1000;
  const euiIllustrative =
    i.floorAreaM2 > 1 ? annualEnergyKwh / i.floorAreaM2 : null;
  const carbonKgPerYr =
    annualEnergyKwh != null ? annualEnergyKwh * Math.max(0, i.design.carbonFactorKgPerKwh) : null;

  const { level: natVentPotential, note: natVentNote } = assessNaturalVentilation(
    i.env.windSpeedMs,
    tOut,
    i.env.indoorSetpointC,
    i.design.ventilationOpenableFraction,
    i.design.naturalVentilationOn,
  );

  if (!Number.isFinite(dT)) warnings.push('Temperature inputs invalid; check setpoint/outdoor values.');
  if (G === 0) warnings.push('Solar irradiance is 0 — solar gain and daylight potential will read zero.');
  if (solarGainW > 3 * Math.abs(transmissionTotalW) && solarGainW > 1000)
    warnings.push(
      'Solar gain dominates: irradiance is applied to all glazing simultaneously (conservative peak — real orientation diversity would lower it).',
    );
  if (ach === 0) warnings.push('Infiltration is 0 ACH — ventilation heat flow is excluded.');
  if (nvCredit > 0)
    warnings.push(
      `Natural-ventilation free-cooling credit of ${Math.round(nvCredit * 100)}% applied (simplified, not CFD).`,
    );

  return {
    mode: 'analytical-demo',
    deltaTK: dT,
    components: comps,
    transmissionTotalW,
    solarGainW,
    internalGainsW,
    ventilationW,
    heatingLoadW,
    coolingLoadW,
    activeMode,
    operativeTempFreeC,
    operativeTempMaintainedC,
    comfortStatus,
    daylightPotentialPct,
    euiIllustrative,
    annualEnergyKwh,
    carbonKgPerYr,
    natVentPotential,
    natVentNote,
    transmissionByComponent: comps.map((c) => ({ label: c.label, valueW: Math.abs(c.qW) })),
    warnings,
  };
}

export function classifyComfort(tOp: number): CalcResults['comfortStatus'] {
  if (tOp < 18) return 'cold';
  if (tOp < 20) return 'cool';
  if (tOp < 21.5) return 'slightly-cool';
  if (tOp <= 24.5) return 'comfortable';
  if (tOp <= 26.5) return 'slightly-warm';
  if (tOp <= 29) return 'warm';
  return 'hot';
}

function scaledWwrFactor(glazingM2: number, floorAreaM2: number): number {
  if (floorAreaM2 <= 0) return 0.3;
  return Math.min(1, glazingM2 / floorAreaM2);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function assessNaturalVentilation(
  windMs: number,
  tOut: number,
  tSet: number,
  openable: number,
  enabled: boolean,
): { level: CalcResults['natVentPotential']; note: string } {
  if (!enabled)
    return { level: 'none', note: 'Natural ventilation disabled in design settings.' };
  if (tOut < 16)
    return { level: 'low', note: 'Outdoor air too cool for comfort ventilation without reheat.' };
  if (tOut > tSet + 3)
    return {
      level: 'low',
      note: 'Outdoor air warmer than setpoint — ventilation adds heat; use night flushing only.',
    };
  if (windMs < 0.5)
    return { level: 'low', note: 'Wind speed below 0.5 m/s — stack effect only; limited air change.' };
  if (windMs >= 2 && openable >= 0.15)
    return { level: 'high', note: 'Good cross-ventilation potential: adequate wind and openable area.' };
  return { level: 'moderate', note: 'Moderate potential: some free cooling available; increase openable area for more.' };
}

/** Sweep outdoor temperature → heating/cooling loads for the chart. */
export function sweepOutdoorTemp(
  base: HeatBalanceInputs,
  fromC: number,
  toC: number,
  steps: number,
): { tOut: number; heatingW: number; coolingW: number }[] {
  const pts: { tOut: number; heatingW: number; coolingW: number }[] = [];
  for (let k = 0; k < steps; k++) {
    const t = fromC + ((toC - fromC) * k) / Math.max(1, steps - 1);
    const r = heatBalance({ ...base, env: { ...base.env, outdoorTempC: t } });
    pts.push({ tOut: Math.round(t * 10) / 10, heatingW: r.heatingLoadW, coolingW: r.coolingLoadW });
  }
  return pts;
}

/** Sweep irradiance → solar gain for the chart. */
export function sweepSolar(
  base: HeatBalanceInputs,
  fromWm2: number,
  toWm2: number,
  steps: number,
): { solar: number; gainW: number }[] {
  const pts: { solar: number; gainW: number }[] = [];
  for (let k = 0; k < steps; k++) {
    const g = fromWm2 + ((toWm2 - fromWm2) * k) / Math.max(1, steps - 1);
    const r = heatBalance({ ...base, env: { ...base.env, solarIrradianceWm2: g } });
    pts.push({ solar: Math.round(g), gainW: r.solarGainW });
  }
  return pts;
}

export function formatKW(watts: number): string {
  return (watts / 1000).toFixed(2);
}
