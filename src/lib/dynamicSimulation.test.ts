import { describe, it, expect } from 'vitest';
import { sampleBuilding } from './sampleBuilding';
import { runDynamicIsoSimulation, generateEnergyPlusIdf } from './dynamicSimulation';
import type { DesignInputs, EnvInputs } from './types';

const mockEnv: EnvInputs = {
  outdoorTempC: 15,
  solarIrradianceWm2: 450,
  cloudCoverPct: 30,
  windSpeedMs: 2.5,
  relHumidityPct: 55,
  indoorSetpointC: 21,
  analysisDate: '2026-06-01',
};

const mockDesign: DesignInputs = {
  wallU: { value: 0.35, provenance: 'assumption' },
  roofU: { value: 0.25, provenance: 'assumption' },
  glazingU: { value: 1.4, provenance: 'assumption' },
  slabU: { value: 0.35, provenance: 'assumption' },
  doorU: { value: 2.2, provenance: 'assumption' },
  shgc: { value: 0.35, provenance: 'assumption' },
  shadingFactor: { value: 1.0, provenance: 'assumption' },
  wwr: { value: 0.4, provenance: 'derived' },
  orientationDeg: 0,
  infiltrationACH: 0.5,
  internalGainsWm2: 8,
  ventilationOpenableFraction: 0.2,
  greenRoofFraction: 0,
  greenWallFraction: 0,
  naturalVentilationOn: true,
  euiTargetKwhM2Yr: 100,
  carbonFactorKgPerKwh: 0.4,
  equivHeatingHours: 800,
  equivCoolingHours: 1200,
};

describe('Dynamic Building Energy Simulation Engine (ISO 52016-1)', () => {
  const model = sampleBuilding();

  it('runs 12-month dynamic simulation and returns realistic EUI and breakdowns', () => {
    const res = runDynamicIsoSimulation(model, mockEnv, mockDesign);

    expect(res.monthlyBreakdown).toHaveLength(12);
    expect(res.dynamicEuiKwhM2Yr).toBeGreaterThan(25);
    expect(res.dynamicEuiKwhM2Yr).toBeLessThan(180); // Realistic commercial office EUI range (usually 60-120 kWh/m²/yr)
    expect(res.annualHeatingElectricKwh).toBeGreaterThanOrEqual(0);
    expect(res.annualCoolingElectricKwh).toBeGreaterThanOrEqual(0);
    expect(res.annualLightingKwh).toBeGreaterThan(0);
    expect(res.annualEquipmentKwh).toBeGreaterThan(0);
    expect(res.peakHeatingLoadKw).toBeGreaterThan(0);
    expect(res.peakCoolingLoadKw).toBeGreaterThan(0);
  });

  it('generates a valid EnergyPlus IDF file format', () => {
    const idf = generateEnergyPlusIdf(model, mockDesign, mockEnv, 'Test_Project');

    expect(idf).toContain('Version, 24.1;');
    expect(idf).toContain('Building,');
    expect(idf).toContain('Zone,');
    expect(idf).toContain('Material,');
    expect(idf).toContain('HVACTemplate:Zone:IdealLoadsAirSystem,');
    expect(idf).toContain('SimpleGlazingSystem');
  });
});

