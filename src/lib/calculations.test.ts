import { describe, expect, it } from 'vitest';
import {
  assessNaturalVentilation,
  classifyComfort,
  heatBalance,
  scaledGlazingArea,
  summarizeEnvelope,
} from './calculations';
import type { BuildingModel, DesignInputs, EnvInputs } from './types';

function testEnv(over: Partial<EnvInputs> = {}): EnvInputs {
  return {
    outdoorTempC: 35,
    solarIrradianceWm2: 800,
    cloudCoverPct: 10,
    windSpeedMs: 2,
    relHumidityPct: 40,
    indoorSetpointC: 22,
    analysisDate: '2026-06-01',
    ...over,
  };
}

function testDesign(over: Partial<DesignInputs> = {}): DesignInputs {
  const pv = (value: number) => ({ value, provenance: 'assumption' as const });
  return {
    wallU: pv(0.35),
    roofU: pv(0.25),
    glazingU: pv(1.4),
    shgc: pv(0.35),
    shadingFactor: pv(1),
    wwr: pv(0.4),
    orientationDeg: 0,
    infiltrationACH: 0.5,
    internalGainsWm2: 8,
    ventilationOpenableFraction: 0.2,
    greenRoofFraction: 0,
    greenWallFraction: 0,
    naturalVentilationOn: false,
    euiTargetKwhM2Yr: 100,
    carbonFactorKgPerKwh: 0.4,
    equivHeatingHours: 800,
    equivCoolingHours: 1200,
    ...over,
  };
}

/** Hand-check sample: wall 200 m² @ U0.35, roof 240 @ 0.25, glazing 120 @ 1.4,
 *  dT = 22−35 = −13 K → Q_tr = −(0.35·200 + 0.25·240 + 1.4·120)·13 = −(70+60+168)·13 = −3874 W. */
const SAMPLE_AREAS = { wallM2: 200, roofM2: 240, glazingM2: 120 };

describe('heatBalance physics', () => {
  it('computes transmission Q=U·A·ΔT per component with correct sign', () => {
    const r = heatBalance({
      areas: SAMPLE_AREAS,
      uValues: { wallU: 0.35, roofU: 0.25, glazingU: 1.4 },
      env: testEnv(),
      design: testDesign(),
      volumeM3: 1000,
      floorAreaM2: 240,
    });
    const wall = r.components.find((c) => c.key === 'wall')!;
    expect(wall.qW).toBeCloseTo(0.35 * 200 * -13, 6);
    expect(r.transmissionTotalW).toBeCloseTo(-3874, 0);
  });

  it('warming outdoor temp raises cooling and lowers heating monotonically', () => {
    const mk = (t: number) =>
      heatBalance({
        areas: SAMPLE_AREAS,
        uValues: { wallU: 0.35, roofU: 0.25, glazingU: 1.4 },
        env: testEnv({ outdoorTempC: t, solarIrradianceWm2: 500 }),
        design: testDesign(),
        volumeM3: 1000,
        floorAreaM2: 240,
      });
    const cool = mk(30);
    const hot = mk(40);
    expect(hot.coolingLoadW).toBeGreaterThan(cool.coolingLoadW);
    expect(hot.heatingLoadW).toBeLessThanOrEqual(cool.heatingLoadW);
  });

  it('solar gain scales linearly with irradiance, area, SHGC, shading', () => {
    const mk = (g: number, shgc: number, shade: number) =>
      heatBalance({
        areas: SAMPLE_AREAS,
        uValues: { wallU: 0.35, roofU: 0.25, glazingU: 1.4 },
        env: testEnv({ solarIrradianceWm2: g }),
        design: testDesign({
          shgc: { value: shgc, provenance: 'user' },
          shadingFactor: { value: shade, provenance: 'user' },
        }),
        volumeM3: 1000,
        floorAreaM2: 240,
      });
    const a = mk(800, 0.4, 1);
    expect(a.solarGainW).toBeCloseTo(800 * 120 * 0.4 * 1, 6);
    const b = mk(400, 0.4, 1);
    expect(b.solarGainW).toBeCloseTo(a.solarGainW / 2, 6);
    const c = mk(800, 0.4, 0.5);
    expect(c.solarGainW).toBeCloseTo(a.solarGainW / 2, 6);
  });

  it('better insulation (lower U) reduces heating load in winter', () => {
    const mk = (u: number) =>
      heatBalance({
        areas: SAMPLE_AREAS,
        uValues: { wallU: u, roofU: 0.25, glazingU: 1.4 },
        env: testEnv({ outdoorTempC: 0, solarIrradianceWm2: 100 }),
        design: testDesign(),
        volumeM3: 1000,
        floorAreaM2: 240,
      });
    expect(mk(0.2).heatingLoadW).toBeLessThan(mk(1.0).heatingLoadW);
  });

  it('cloud cover alone never changes solar gain (no hidden multiplier)', () => {
    const mk = (cloud: number) =>
      heatBalance({
        areas: SAMPLE_AREAS,
        uValues: { wallU: 0.35, roofU: 0.25, glazingU: 1.4 },
        env: testEnv({ cloudCoverPct: cloud }),
        design: testDesign(),
        volumeM3: 1000,
        floorAreaM2: 240,
      });
    expect(mk(0).solarGainW).toBe(mk(95).solarGainW);
  });

  it('EUI annualization matches disclosed formula', () => {
    const r = heatBalance({
      areas: SAMPLE_AREAS,
      uValues: { wallU: 0.35, roofU: 0.25, glazingU: 1.4 },
      env: testEnv(),
      design: testDesign(),
      volumeM3: 1000,
      floorAreaM2: 240,
    });
    const expected =
      (r.heatingLoadW * 800 + r.coolingLoadW * 1200) / 1000 / 240;
    expect(r.euiIllustrative).toBeCloseTo(expected, 9);
  });
});

describe('helpers', () => {
  it('classifyComfort bands', () => {
    expect(classifyComfort(22)).toBe('comfortable');
    expect(classifyComfort(17)).toBe('cold');
    expect(classifyComfort(31)).toBe('hot');
  });

  it('scaledGlazingArea conserves wall band and clamps WWR', () => {
    const s = scaledGlazingArea(
      {
        wallArea: 200,
        windowArea: 120,
        roofArea: 0,
        floorArea: 0,
        doorArea: 0,
        totalExterior: 320,
        wwr: 0.375,
        wwrProvenance: 'derived',
      },
      0.5,
    );
    expect(s.glazingM2 + s.opaqueWallM2).toBeCloseTo(320, 9);
    expect(s.glazingM2).toBeCloseTo(160, 9);
  });

  it('summarizeEnvelope derives WWR from geometry', () => {
    const model = {
      elements: [
        { category: 'wall', areaM2: 200 },
        { category: 'window', areaM2: 120 },
        { category: 'roof', areaM2: 240 },
      ],
    } as unknown as BuildingModel;
    const s = summarizeEnvelope(model);
    expect(s.wwr).toBeCloseTo(120 / 320, 9);
    expect(s.totalExterior).toBe(200 + 120 + 240);
  });

  it('natural ventilation assessment is conservative without solver', () => {
    expect(
      assessNaturalVentilation(3, 22, 24, 0.2, false).level,
    ).toBe('none');
    expect(assessNaturalVentilation(3, 22, 24, 0.2, true).level).toBe(
      'high',
    );
    expect(assessNaturalVentilation(3, 30, 24, 0.2, true).level).toBe('low');
  });
});
