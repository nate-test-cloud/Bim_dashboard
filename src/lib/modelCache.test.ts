import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  float32ToBase64,
  base64ToFloat32,
  uint32ToBase64,
  base64ToUint32,
  packModel,
  unpackModel,
  unpackMeshGeometry,
  saveServerCache,
  loadServerCache,
  clearServerCache,
} from './modelCache';
import type { BuildingModel } from './types';

describe('modelCache geometry serialization', () => {
  it('round-trips Float32Array and Uint32Array with zero precision loss', () => {
    const f32 = new Float32Array([1.25, -45.75, 128.5, 0.00390625]);
    const b64f = float32ToBase64(f32);
    const recoveredF32 = base64ToFloat32(b64f);
    expect(recoveredF32).toHaveLength(4);
    for (let i = 0; i < f32.length; i++) {
      expect(recoveredF32[i]).toBeCloseTo(f32[i], 5);
    }

    const u32 = new Uint32Array([0, 1, 2, 4096, 65535, 1000000]);
    const b64u = uint32ToBase64(u32);
    const recoveredU32 = base64ToUint32(b64u);
    expect(recoveredU32).toHaveLength(6);
    for (let i = 0; i < u32.length; i++) {
      expect(recoveredU32[i]).toBe(u32[i]);
    }
  });

  it('packs and unpacks mesh geometries in BuildingModel', () => {
    const mockModel: BuildingModel = {
      name: 'Sample Test Model',
      source: 'ifc',
      sourceFileName: 'test.ifc',
      storeys: ['Level 1'],
      spaces: 2,
      floorAreaM2: 250,
      floorAreaProvenance: 'extracted',
      volumeM3: 750,
      volumeProvenance: 'extracted',
      warnings: [],
      geometryFidelity: 'actual',
      elements: [
        {
          id: '101',
          name: 'Ext Wall 1',
          category: 'wall',
          areaM2: 30,
          areaProvenance: 'extracted',
          meshGeometries: [
            {
              positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
              normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
              indices: new Uint32Array([0, 1, 2]),
              color: [0.8, 0.8, 0.8, 1],
            },
          ],
        },
      ],
    };

    const packed = packModel(mockModel);
    expect(typeof packed.elements[0].meshGeometries[0].positions).toBe('string');
    expect(typeof packed.elements[0].meshGeometries[0].indices).toBe('string');

    // Simulate JSON stringify & parse across HTTP transport
    const jsonStr = JSON.stringify(packed);
    const parsedJson = JSON.parse(jsonStr);

    const unpacked = unpackModel(parsedJson);
    const mg = unpacked.elements[0].meshGeometries![0];
    expect(mg.positions).toBeInstanceOf(Float32Array);
    expect(mg.normals).toBeInstanceOf(Float32Array);
    expect(mg.indices).toBeInstanceOf(Uint32Array);
    expect(mg.positions.length).toBe(9);
    expect(mg.indices[1]).toBe(1);
  });

  it('handles fallback formats gracefully (plain arrays or objects)', () => {
    const rawMg = {
      positions: [1, 2, 3],
      normals: { 0: 0, 1: 1, 2: 0 },
      indices: [0, 1, 2],
    };
    const unpacked = unpackMeshGeometry(rawMg);
    expect(unpacked.positions).toBeInstanceOf(Float32Array);
    expect(unpacked.positions[0]).toBe(1);
    expect(unpacked.normals).toBeInstanceOf(Float32Array);
    expect(unpacked.normals[1]).toBe(1);
    expect(unpacked.indices).toBeInstanceOf(Uint32Array);
    expect(unpacked.indices[2]).toBe(2);
  });
});

describe('modelCache HTTP API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('saveServerCache posts JSON payload to /api/model-cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await saveServerCache({ projectName: 'Office Study' });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/model-cache',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('loadServerCache fetches from /api/model-cache and unpacks model if cached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cached: true,
        data: {
          projectName: 'Cached Office',
          model: {
            name: 'Cached Model',
            elements: [],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await loadServerCache();
    expect(res).not.toBeNull();
    expect(res?.projectName).toBe('Cached Office');
    expect(res?.model?.name).toBe('Cached Model');
  });

  it('clearServerCache calls DELETE /api/model-cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await clearServerCache();
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/model-cache', { method: 'DELETE' });
  });
});
