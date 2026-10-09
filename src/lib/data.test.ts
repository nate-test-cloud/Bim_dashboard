import { describe, expect, it } from 'vitest';
import { parseClimateCsv, SAMPLE_CLIMATE_CSV } from './climateCsv';
import { sampleBuilding } from './sampleBuilding';
import { heatBalance, summarizeEnvelope } from './calculations';
import { toCsv, toJson } from './exports';
import { loadProject, saveProject, clearProject } from './persistence';

describe('sample building integrity', () => {
  it('has positive areas, conserved wall band and WWR 0.40', () => {
    const m = sampleBuilding();
    for (const e of m.elements) expect(e.areaM2).toBeGreaterThan(0);
    const s = summarizeEnvelope(m);
    expect(s.wallArea + s.windowArea).toBeCloseTo(448, 0);
    expect(s.wwr).toBeCloseTo(0.4, 2);
    expect(s.roofArea).toBe(240);
    expect(m.floorAreaM2).toBe(480);
    expect(m.volumeM3).toBe(1680);
  });
});

describe('exports reflect live state', () => {
  it('CSV/JSON contain current inputs and computed results', () => {
    const model = sampleBuilding();
    const design = {
      wallU: { value: 0.35, provenance: 'assumption' as const },
      roofU: { value: 0.25, provenance: 'assumption' as const },
      glazingU: { value: 1.4, provenance: 'assumption' as const },
      shgc: { value: 0.35, provenance: 'assumption' as const },
      shadingFactor: { value: 0.5, provenance: 'user' as const },
      wwr: { value: 0.4, provenance: 'derived' as const },
      orientationDeg: 0, infiltrationACH: 0.5, internalGainsWm2: 8,
      ventilationOpenableFraction: 0.2, greenRoofFraction: 0, greenWallFraction: 0,
      naturalVentilationOn: false, euiTargetKwhM2Yr: 100, carbonFactorKgPerKwh: 0.4,
      equivHeatingHours: 800, equivCoolingHours: 1200,
    };
    const env = {
      outdoorTempC: 30, solarIrradianceWm2: 900, cloudCoverPct: 10, windSpeedMs: 2,
      relHumidityPct: 40, indoorSetpointC: 22, analysisDate: '2026-06-01',
    };
    const s = summarizeEnvelope(model);
    const results = heatBalance({
      areas: { wallM2: s.wallArea, roofM2: s.roofArea, glazingM2: s.windowArea, doorM2: s.doorArea },
      uValues: { wallU: 0.35, roofU: 0.25, glazingU: 1.4, doorU: 2.2 },
      env, design, volumeM3: model.volumeM3, floorAreaM2: model.floorAreaM2,
    });
    const bundle = { projectName: 'Test', model, env, design, results, scenarios: [], scenarioResults: [] };
    const csv = toCsv(bundle);
    expect(csv).toContain('30'); // live outdoor temp
    expect(csv).toContain('900'); // live solar
    expect(csv).toContain(results.heatingLoadW.toFixed(1));
    const json = JSON.parse(toJson(bundle));
    expect(json.environment.outdoorTempC).toBe(30);
    expect(json.results.coolingLoadW).toBe(results.coolingLoadW);
    expect(json.analysisMode).toBe('analytical-demo');
  });
});

describe('persistence round-trip', () => {
  it('saves and restores the project via localStorage', () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      },
      configurable: true,
    });
    saveProject({ projectName: 'P', env: { a: 1 }, design: { b: 2 }, scenarios: [], modelMeta: null, euiTarget: 100 });
    const back = loadProject();
    expect(back?.projectName).toBe('P');
    expect(back?.savedAt).toBeTruthy();
    clearProject();
    expect(loadProject()).toBeNull();
  });
});
describe('climateCsv', () => {
  it('parses the bundled sample file into 12 monthly rows', () => {
    const t = parseClimateCsv(SAMPLE_CLIMATE_CSV);
    expect(t.rows).toHaveLength(12);
    expect(t.monthlyAverages.length).toBeGreaterThanOrEqual(3);
    expect(t.rows[6].outdoorTempC).toBe(26);
  });

  it('rejects bad headers and skips bad rows with warnings', () => {
    expect(() => parseClimateCsv('a,b,c\n1,2,3')).toThrow(/Missing required columns/);
    const t = parseClimateCsv(
      'timestamp,outdoorTempC,solarWm2,relHumidityPct,windMs\n2026-01-01,8,180,78,4.5\nbad-row,xx,yy,zz,qq',
    );
    expect(t.rows).toHaveLength(1);
    expect(t.warnings.length).toBeGreaterThan(0);
  });
});
