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
  FacadeSolarGain,
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
  areas: { wallM2: number; roofM2: number; glazingM2: number; doorM2?: number; slabM2?: number };
  uValues: { wallU: number; roofU: number; glazingU: number; doorU?: number; slabU?: number };
  env: EnvInputs;
  design: DesignInputs;
  volumeM3: number;
  floorAreaM2: number;
  latitude?: number;
  model?: BuildingModel;
}

/** Psychrometric humidity ratio (g water / kg dry air) via Magnus-Tetens equation */
export function calcHumidityRatio(tempC: number, relHumidityPct: number): number {
  const pSat = 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3)); // Pa
  const rh = Math.max(0, Math.min(100, relHumidityPct)) / 100;
  const pv = rh * pSat;
  const pAtm = 101325; // standard atmospheric pressure (Pa)
  const wKg = 0.622 * (pv / Math.max(100, pAtm - pv));
  return Number((wKg * 1000).toFixed(2));
}

/** Approximate solar altitude and azimuth at solar noon based on date and latitude */
export function calcSolarPosition(analysisDate?: string, latitude = 45): { altitudeDeg: number; azimuthDeg: number } {
  let dayOfYear = 152; // Default June 1
  if (analysisDate) {
    const parts = analysisDate.split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      const start = new Date(parts[0], 0, 0);
      const diff = d.getTime() - start.getTime();
      const oneDay = 1000 * 60 * 60 * 24;
      dayOfYear = Math.floor(diff / oneDay);
    }
  }
  const deltaRad = (23.45 * Math.sin(((360 / 365) * (284 + dayOfYear) * Math.PI) / 180) * Math.PI) / 180;
  const latRad = (latitude * Math.PI) / 180;
  const altRad = Math.asin(Math.sin(latRad) * Math.sin(deltaRad) + Math.cos(latRad) * Math.cos(deltaRad));
  const altitudeDeg = Math.max(5, Math.min(88, Math.round(((altRad * 180) / Math.PI) * 10) / 10));
  const azimuthDeg = latitude >= 0 ? 180 : 0;
  return { altitudeDeg, azimuthDeg };
}

/** Directional solar gains resolved across 4 oriented facades (N, E, S, W) */
export function calcDirectionalSolarGains(
  glazingM2: number,
  irradianceWm2: number,
  shgc: number,
  shadingFactor: number,
  orientationDeg: number,
  cloudCoverPct: number,
  sunPos: { altitudeDeg: number; azimuthDeg: number }
): { totalGainW: number; breakdown: FacadeSolarGain[] } {
  const G = Math.max(0, irradianceWm2);
  const facades = [
    { label: 'North Facade', baseAzimuth: 0 },
    { label: 'East Facade', baseAzimuth: 90 },
    { label: 'South Facade', baseAzimuth: 180 },
    { label: 'West Facade', baseAzimuth: 270 },
  ];

  if (G === 0 || glazingM2 <= 0) {
    return {
      totalGainW: 0,
      breakdown: facades.map((f) => ({
        orientation: f.label,
        azimuthDeg: (f.baseAzimuth + orientationDeg) % 360,
        glazingM2: +(glazingM2 / 4).toFixed(1),
        incidentWm2: 0,
        gainW: 0,
      })),
    };
  }

  const cloud = clamp01(cloudCoverPct / 100);
  const altRad = (sunPos.altitudeDeg * Math.PI) / 180;
  // Clear sky direct beam normal to sun direction attenuates as cloud cover increases
  const beamStrength = Math.max(0, (1 - 0.85 * Math.pow(cloud, 1.5)) * Math.sin(altRad));
  // Diffuse sky component decreases with heavy cloud extinction
  const diffuseFactor = Math.max(0.12, 0.45 * (1 - 0.65 * cloud));

  const effectiveShgc = clamp01(shgc) * clamp01(shadingFactor);
  const areaPerFacade = glazingM2 / 4;
  let totalGainW = 0;

  const breakdown: FacadeSolarGain[] = facades.map((f) => {
    const rotatedAzimuth = (f.baseAzimuth + orientationDeg) % 360;
    const relAzimuthRad = ((sunPos.azimuthDeg - rotatedAzimuth) * Math.PI) / 180;
    const cosTheta = Math.cos(altRad) * Math.cos(relAzimuthRad);
    const incidentBeam = beamStrength * Math.max(0, cosTheta);
    const incidentDiffuse = diffuseFactor * 0.5; // Sky view factor = 0.5 for vertical wall
    const incidentWm2 = Math.round(G * (incidentBeam + incidentDiffuse));
    const gainW = incidentWm2 * areaPerFacade * effectiveShgc;
    totalGainW += gainW;

    return {
      orientation: f.label,
      azimuthDeg: rotatedAzimuth,
      glazingM2: +areaPerFacade.toFixed(1),
      incidentWm2,
      gainW: +gainW.toFixed(1),
    };
  });

  return { totalGainW: +totalGainW.toFixed(1), breakdown };
}

/** Standard cradle-to-gate (A1-A3) embodied carbon estimation (kgCO2e) */
export function calcEmbodiedCarbon(
  areas: { wallM2: number; roofM2: number; glazingM2: number; slabM2?: number; doorM2?: number },
  floorAreaM2: number
): number {
  const slabArea = areas.slabM2 ?? floorAreaM2;
  const wallCarbon = areas.wallM2 * 65;
  const glazingCarbon = areas.glazingM2 * 75;
  const roofCarbon = areas.roofM2 * 50;
  const slabCarbon = slabArea * 90;
  const structureCarbon = Math.max(1, floorAreaM2) * 110;
  const doorCarbon = (areas.doorM2 ?? 0) * 35;

  return Math.round(wallCarbon + glazingCarbon + roofCarbon + slabCarbon + structureCarbon + doorCarbon);
}

/** Thermal comfort assessment including PMV/PPD and ASHRAE 55 Adaptive Comfort */
export function calcThermalComfort(
  tOp: number,
  tOut: number,
  tSet: number,
  rhPct: number,
  windMs: number,
  natVentOn: boolean
): {
  status: CalcResults['comfortStatus'];
  pmv: number;
  ppd: number;
  adaptiveCompliance?: boolean;
  adaptiveNote?: string;
} {
  const status = classifyComfort(tOp);

  // Simplified PMV based on thermal imbalance, humidity, and air movement
  const tempOffset = tOp - tSet;
  const rhOffset = (rhPct - 50) / 100;
  const airOffset = Math.max(0, windMs - 0.15);
  const rawPmv = tempOffset * 0.38 + rhOffset * 0.25 - airOffset * 0.12;
  const pmv = Number(Math.max(-3, Math.min(3, rawPmv)).toFixed(2));
  const ppd = Number((100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2))).toFixed(1));

  let adaptiveCompliance: boolean | undefined;
  let adaptiveNote: string | undefined;

  if (natVentOn && tOut >= 10 && tOut <= 33) {
    const tComf = 17.8 + 0.31 * tOut;
    const diff = Math.abs(tOp - tComf);
    if (diff <= 2.5) {
      adaptiveCompliance = true;
      adaptiveNote = `Complies with ASHRAE 55 Class I (90% satisfaction, neutral ${tComf.toFixed(1)}°C ±2.5°C)`;
    } else if (diff <= 3.5) {
      adaptiveCompliance = true;
      adaptiveNote = `Complies with ASHRAE 55 Class II (80% satisfaction, neutral ${tComf.toFixed(1)}°C ±3.5°C)`;
    } else {
      adaptiveCompliance = false;
      adaptiveNote = `Outside ASHRAE 55 adaptive comfort limits (${tOp.toFixed(1)}°C vs ${tComf.toFixed(1)}°C ±3.5°C)`;
    }
  }

  return { status, pmv, ppd, adaptiveCompliance, adaptiveNote };
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

  // ISO 13370 Ground slab conduction
  if ((i.areas.slabM2 ?? 0) > 0) {
    const slabU = i.uValues.slabU ?? 0.35;
    // Ground temperature dampened by soil thermal inertia
    const tGround = i.env.indoorSetpointC - 0.4 * dT;
    comps.push({
      key: 'slab',
      label: 'Ground Slab',
      areaM2: i.areas.slabM2 ?? 0,
      uValue: slabU,
      qW: slabU * (i.areas.slabM2 ?? 0) * (i.env.indoorSetpointC - tGround),
    });
  }

  const transmissionTotalW = comps.reduce((a, c) => a + c.qW, 0);

  // Solar position & Directional Solar Gain
  const sunPosition = calcSolarPosition(i.env.analysisDate, i.latitude ?? 45);
  const { totalGainW: solarGainW, breakdown: facadeBreakdown } = calcDirectionalSolarGains(
    i.areas.glazingM2,
    i.env.solarIrradianceWm2,
    i.design.shgc.value,
    i.design.shadingFactor.value,
    i.design.orientationDeg,
    i.env.cloudCoverPct,
    sunPosition
  );

  const internalGainsW = Math.max(0, i.design.internalGainsWm2) * Math.max(1, i.floorAreaM2);

  const ach = Math.max(0, i.design.infiltrationACH);
  const hVe = 0.33 * ach * Math.max(1, i.volumeM3);
  const ventilationW = hVe * dT;

  // Sensible HVAC demand at indoor setpoint
  let qHvacSensible = transmissionTotalW + ventilationW - solarGainW - internalGainsW;

  // Natural-ventilation free-cooling credit (disclosed approximation)
  let nvCredit = 0;
  const tOut = i.env.outdoorTempC;
  const canFreeCool =
    i.design.naturalVentilationOn &&
    tOut >= 16 &&
    tOut <= i.env.indoorSetpointC &&
    i.env.windSpeedMs > 0.5;
  if (canFreeCool && qHvacSensible < 0) {
    nvCredit = Math.min(0.4, 0.1 + 0.1 * i.env.windSpeedMs * i.design.ventilationOpenableFraction * 4);
    qHvacSensible = qHvacSensible * (1 - nvCredit);
  }

  // Psychrometric moisture & latent cooling load
  const humidityRatioOutGKg = calcHumidityRatio(tOut, i.env.relHumidityPct);
  const humidityRatioInGKg = calcHumidityRatio(i.env.indoorSetpointC, 50); // 50% RH comfort target
  const dW = Math.max(0, humidityRatioOutGKg - humidityRatioInGKg) / 1000; // kg/kg
  const airDensity = 1.2; // kg/m³
  const mDotAir = (airDensity * ach * Math.max(1, i.volumeM3)) / 3600; // kg/s
  const hFg = 2450000; // J/kg latent heat of vaporization
  const latentCoolingLoadW = qHvacSensible < 0 && ach > 0 ? +(mDotAir * hFg * dW).toFixed(1) : 0;

  const heatingLoadW = qHvacSensible > 0 ? +qHvacSensible.toFixed(1) : 0;
  const sensibleCoolingLoadW = qHvacSensible < 0 ? +-qHvacSensible.toFixed(1) : 0;
  const coolingLoadW = sensibleCoolingLoadW + latentCoolingLoadW;
  const activeMode = heatingLoadW > 5 ? 'heating' : coolingLoadW > 5 ? 'cooling' : 'neutral';

  // Free-running operative temperature
  const hTr = comps.reduce((a, c) => a + c.uValue * c.areaM2, 0);
  const hTot = hTr + hVe;
  const operativeTempFreeC = hTot > 1 ? tOut + (solarGainW + internalGainsW) / hTot : tOut;
  const operativeTempMaintainedC =
    activeMode === 'neutral'
      ? operativeTempFreeC
      : i.env.indoorSetpointC + (heatingLoadW > 0 ? -0.2 : 0.4);

  const { status: comfortStatus, pmv, ppd, adaptiveCompliance, adaptiveNote } = calcThermalComfort(
    operativeTempMaintainedC,
    tOut,
    i.env.indoorSetpointC,
    i.env.relHumidityPct,
    i.env.windSpeedMs,
    i.design.naturalVentilationOn
  );

  // Daylight potential index — explicitly not DA
  const tauVis = Math.min(0.9, clamp01(i.design.shgc.value) * 1.15);
  const kGeo = Math.min(1, 0.25 + scaledWwrFactor(i.areas.glazingM2, i.floorAreaM2));
  const daylightPotentialPct =
    Math.round(Math.min(1, (i.env.solarIrradianceWm2 / 1000) * tauVis * 2.2 * kGeo + (i.env.solarIrradianceWm2 > 50 ? 0.12 : 0)) * 100);

  // Illustrative annualization
  const annualEnergyKwh =
    (heatingLoadW * Math.max(0, i.design.equivHeatingHours) +
      coolingLoadW * Math.max(0, i.design.equivCoolingHours)) /
    1000;
  const euiIllustrative =
    i.floorAreaM2 > 1 ? annualEnergyKwh / i.floorAreaM2 : null;
  const carbonKgPerYr =
    annualEnergyKwh != null ? +(annualEnergyKwh * Math.max(0, i.design.carbonFactorKgPerKwh)).toFixed(1) : null;

  // Embodied & Life Cycle Carbon
  const embodiedCarbonKg = calcEmbodiedCarbon(i.areas, i.floorAreaM2);
  const totalLifeCycleCarbonKg =
    carbonKgPerYr != null ? Math.round(embodiedCarbonKg + carbonKgPerYr * 50) : embodiedCarbonKg;

  // EUI Target Benchmarking
  const euiTargetVariance =
    euiIllustrative != null ? +(euiIllustrative - i.design.euiTargetKwhM2Yr).toFixed(1) : null;
  const euiCompliant = euiIllustrative != null ? euiIllustrative <= i.design.euiTargetKwhM2Yr : null;

  const { level: natVentPotential, note: natVentNote } = assessNaturalVentilation(
    i.env.windSpeedMs,
    tOut,
    i.env.indoorSetpointC,
    i.design.ventilationOpenableFraction,
    i.design.naturalVentilationOn,
  );

  if (!Number.isFinite(dT)) warnings.push('Temperature inputs invalid; check setpoint/outdoor values.');
  if (i.env.solarIrradianceWm2 === 0) warnings.push('Solar irradiance is 0 — solar gain and daylight potential will read zero.');
  if (ach === 0) warnings.push('Infiltration is 0 ACH — ventilation heat and moisture flow are excluded.');
  if (latentCoolingLoadW > 0)
    warnings.push(
      `Latent cooling load: ${(latentCoolingLoadW / 1000).toFixed(2)} kW required for dehumidification (${humidityRatioOutGKg} g/kg outdoor vs ${humidityRatioInGKg} g/kg target).`
    );
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
    sensibleCoolingLoadW,
    latentCoolingLoadW,
    humidityRatioOutGKg,
    humidityRatioInGKg,
    activeMode,
    operativeTempFreeC,
    operativeTempMaintainedC,
    comfortStatus,
    pmv,
    ppd,
    adaptiveComfortCompliance: adaptiveCompliance,
    adaptiveComfortNote: adaptiveNote,
    daylightPotentialPct,
    euiIllustrative,
    annualEnergyKwh,
    carbonKgPerYr,
    embodiedCarbonKg,
    totalLifeCycleCarbonKg,
    euiTargetVariance,
    euiCompliant,
    natVentPotential,
    natVentNote,
    transmissionByComponent: comps.map((c) => ({ label: c.label, valueW: Math.abs(c.qW) })),
    facadeBreakdown,
    sunPosition,
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
