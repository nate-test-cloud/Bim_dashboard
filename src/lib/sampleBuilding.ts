import type { BuildingModel } from './types';

/**
 * Sample office building with clearly identifiable envelope parts.
 * 20 m × 12 m footprint, 2 storeys @ 3.5 m → 7 m tall, flat roof.
 * Glazing: continuous strip windows, WWR = 0.40 of the wall band.
 *
 * Wall band perimeter = 2·(20+12) = 64 m; gross wall band = 64·7 = 448 m².
 *   → glazing = 179.2 m², opaque wall = 268.8 m².
 * Roof = 240 m², ground floor = 240 m², floor area (2 levels) = 480 m²,
 * volume = 240·7 = 1680 m³. Doors: 2 × 2 m².
 */
export function sampleBuilding(): BuildingModel {
  const wallBand = 448;
  const glazing = +(wallBand * 0.4).toFixed(1); // 179.2
  const opaque = +(wallBand * 0.6).toFixed(1); // 268.8
  // Opaque split by facade share (N 31% / S 31% / E 19% / W 19% — sums to 100%).
  const oN = +(opaque * 0.31).toFixed(1);
  const oS = +(opaque * 0.31).toFixed(1);
  const oE = +(opaque * 0.19).toFixed(1);
  const oW = +(opaque - oN - oS - oE).toFixed(1);
  return {
    name: 'Sample Office — 20×12 m, 2 storeys',
    source: 'sample',
    schema: 'internal-sample-v1',
    storeys: ['Ground Floor', 'Level 1'],
    spaces: 8,
    floorAreaM2: 480,
    floorAreaProvenance: 'derived',
    volumeM3: 1680,
    volumeProvenance: 'derived',
    geometryFidelity: 'sample',
    warnings: [],
    elements: [
      {
        id: 'wall-north', name: 'North wall (opaque)', category: 'wall',
        areaM2: oN, areaProvenance: 'derived',
        uValueWm2K: 0.35, uProvenance: 'assumption',
        material: 'Cavity masonry + 100mm mineral wool (assumed)', materialProvenance: 'assumption',
        dims: { x: 20, y: 7, z: 0.3 }, center: { x: 0, y: 3.5, z: -6 },
      },
      {
        id: 'wall-south', name: 'South wall (opaque)', category: 'wall',
        areaM2: oS, areaProvenance: 'derived',
        uValueWm2K: 0.35, uProvenance: 'assumption',
        material: 'Cavity masonry + 100mm mineral wool (assumed)', materialProvenance: 'assumption',
        dims: { x: 20, y: 7, z: 0.3 }, center: { x: 0, y: 3.5, z: 6 },
      },
      {
        id: 'wall-east', name: 'East wall (opaque)', category: 'wall',
        areaM2: oE, areaProvenance: 'derived',
        uValueWm2K: 0.35, uProvenance: 'assumption',
        material: 'Cavity masonry + 100mm mineral wool (assumed)', materialProvenance: 'assumption',
        dims: { x: 0.3, y: 7, z: 12 }, center: { x: 10, y: 3.5, z: 0 },
      },
      {
        id: 'wall-west', name: 'West wall (opaque)', category: 'wall',
        areaM2: oW, areaProvenance: 'derived',
        uValueWm2K: 0.35, uProvenance: 'assumption',
        material: 'Cavity masonry + 100mm mineral wool (assumed)', materialProvenance: 'assumption',
        dims: { x: 0.3, y: 7, z: 12 }, center: { x: -10, y: 3.5, z: 0 },
      },
      {
        id: 'win-north', name: 'North strip windows', category: 'window',
        areaM2: +(glazing * 0.32).toFixed(1), areaProvenance: 'derived',
        uValueWm2K: 1.4, uProvenance: 'assumption',
        material: 'Double low-e glazing, Al frame (assumed)', materialProvenance: 'assumption',
        dims: { x: 18, y: 1.6, z: 0.1 }, center: { x: 0, y: 4.2, z: -6.05 },
      },
      {
        id: 'win-south', name: 'South strip windows', category: 'window',
        areaM2: +(glazing * 0.36).toFixed(1), areaProvenance: 'derived',
        uValueWm2K: 1.4, uProvenance: 'assumption',
        material: 'Double low-e glazing, Al frame (assumed)', materialProvenance: 'assumption',
        dims: { x: 18, y: 1.6, z: 0.1 }, center: { x: 0, y: 4.2, z: 6.05 },
      },
      {
        id: 'win-east', name: 'East strip windows', category: 'window',
        areaM2: +(glazing * 0.16).toFixed(1), areaProvenance: 'derived',
        uValueWm2K: 1.4, uProvenance: 'assumption',
        material: 'Double low-e glazing, Al frame (assumed)', materialProvenance: 'assumption',
        dims: { x: 0.1, y: 1.6, z: 10 }, center: { x: 10.05, y: 4.2, z: 0 },
      },
      {
        id: 'win-west', name: 'West strip windows', category: 'window',
        areaM2: +(glazing - glazing * 0.32 - glazing * 0.36 - glazing * 0.16).toFixed(1),
        areaProvenance: 'derived',
        uValueWm2K: 1.4, uProvenance: 'assumption',
        material: 'Double low-e glazing, Al frame (assumed)', materialProvenance: 'assumption',
        dims: { x: 0.1, y: 1.6, z: 10 }, center: { x: -10.05, y: 4.2, z: 0 },
      },
      {
        id: 'roof-1', name: 'Flat roof', category: 'roof',
        areaM2: 240, areaProvenance: 'derived',
        uValueWm2K: 0.25, uProvenance: 'assumption',
        material: 'Concrete deck + 120mm PIR (assumed)', materialProvenance: 'assumption',
        dims: { x: 20, y: 0.3, z: 12 }, center: { x: 0, y: 7.1, z: 0 },
      },
      {
        id: 'floor-1', name: 'Ground floor slab', category: 'floor',
        areaM2: 240, areaProvenance: 'derived',
        material: 'Ground-bearing slab (assumed)', materialProvenance: 'assumption',
        dims: { x: 20, y: 0.3, z: 12 }, center: { x: 0, y: -0.15, z: 0 },
      },
      {
        id: 'door-main', name: 'Main entrance door', category: 'door',
        areaM2: 4, areaProvenance: 'derived',
        uValueWm2K: 2.2, uProvenance: 'assumption',
        material: 'Glazed entrance doors (assumed)', materialProvenance: 'assumption',
        dims: { x: 2, y: 2.4, z: 0.15 }, center: { x: 0, y: 1.2, z: 6.05 },
      },
    ],
  };
}

/** Optional abstract twisting tower preserved from the original prototype. */
export function demoTower(): BuildingModel {
  return {
    name: 'Demo Tower (abstract — not for envelope analysis)',
    source: 'demo-tower',
    schema: 'procedural-demo-v1',
    storeys: ['Tower (15 levels approx.)'],
    spaces: 0,
    floorAreaM2: 1200,
    floorAreaProvenance: 'assumption',
    volumeM3: 8000,
    volumeProvenance: 'assumption',
    geometryFidelity: 'sample',
    warnings: [
      'Abstract demonstration geometry: envelope areas are illustrative, not extracted.',
    ],
    elements: [
      {
        id: 'tower-shell', name: 'Tower curtain shell', category: 'wall',
        areaM2: 2600, areaProvenance: 'assumption',
        uValueWm2K: 1.8, uProvenance: 'assumption',
        material: 'Illustrative curtain wall', materialProvenance: 'assumption',
      },
      {
        id: 'tower-glazing', name: 'Tower glazing', category: 'window',
        areaM2: 1500, areaProvenance: 'assumption',
        uValueWm2K: 2.0, uProvenance: 'assumption',
        material: 'Illustrative glazing', materialProvenance: 'assumption',
      },
      {
        id: 'tower-roof', name: 'Tower roof', category: 'roof',
        areaM2: 300, areaProvenance: 'assumption',
        uValueWm2K: 0.5, uProvenance: 'assumption',
      },
      {
        id: 'tower-floor', name: 'Tower floors', category: 'floor',
        areaM2: 1200, areaProvenance: 'assumption',
      },
    ],
  };
}

export const DEFAULT_DESIGN = {
  wallU: 0.35,
  roofU: 0.25,
  glazingU: 1.4,
  shgc: 0.35,
  shadingFactor: 1.0,
  wwr: 0.4,
};

export const CLIMATE_PRESETS = {
  arid: {
    label: 'Arid (Riyadh-like)',
    env: { outdoorTempC: 38, solarIrradianceWm2: 1000, cloudCoverPct: 5, windSpeedMs: 2.5, relHumidityPct: 15 },
  },
  tropical: {
    label: 'Tropical (Singapore-like)',
    env: { outdoorTempC: 31, solarIrradianceWm2: 750, cloudCoverPct: 45, windSpeedMs: 1.5, relHumidityPct: 80 },
  },
  temperate: {
    label: 'Temperate (London-like)',
    env: { outdoorTempC: 16, solarIrradianceWm2: 350, cloudCoverPct: 60, windSpeedMs: 4.5, relHumidityPct: 65 },
  },
} as const;
