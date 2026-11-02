/**
 * Server-backed state persistence for the BIM Sustainability CAD Workstation.
 *
 * Keeps the parsed model and active design state stored in the Vite dev server's
 * in-memory cache during the workstation session. Refreshing the browser page
 * immediately restores the parsed model without requiring re-parsing.
 * Terminating the dev server resets the state.
 */

import type { BuildingModel, DesignInputs, EnvInputs, MeshGeometryData, Scenario } from './types';
import type { SiteClimateData, SiteLocation } from './locationClimate';

export interface ServerCachedState {
  projectName?: string;
  model?: BuildingModel;
  modelStatus?: string;
  env?: EnvInputs;
  design?: DesignInputs;
  scenarios?: Scenario[];
  baselineId?: string | null;
  siteLocation?: SiteLocation | null;
  siteClimate?: SiteClimateData | null;
  timestamp?: number;
}

// --- Binary Array / Base64 conversions for 3D Mesh Geometry ------------------

export function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 16384;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

export function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

export function uint32ToBase64(arr: Uint32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 16384;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

export function base64ToUint32(b64: string): Uint32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Uint32Array(bytes.buffer);
}

export function packMeshGeometry(mg: MeshGeometryData): any {
  return {
    positions: mg.positions instanceof Float32Array ? float32ToBase64(mg.positions) : mg.positions,
    normals: mg.normals instanceof Float32Array ? float32ToBase64(mg.normals) : mg.normals,
    indices: mg.indices instanceof Uint32Array ? uint32ToBase64(mg.indices) : mg.indices,
    color: mg.color,
    transform: mg.transform,
  };
}

export function unpackMeshGeometry(mg: any): MeshGeometryData {
  if (!mg) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
    };
  }

  let positions: Float32Array;
  if (mg.positions instanceof Float32Array) {
    positions = mg.positions;
  } else if (typeof mg.positions === 'string') {
    positions = base64ToFloat32(mg.positions);
  } else if (Array.isArray(mg.positions)) {
    positions = new Float32Array(mg.positions);
  } else if (mg.positions && typeof mg.positions === 'object') {
    positions = new Float32Array(Object.values(mg.positions));
  } else {
    positions = new Float32Array(0);
  }

  let normals: Float32Array;
  if (mg.normals instanceof Float32Array) {
    normals = mg.normals;
  } else if (typeof mg.normals === 'string') {
    normals = base64ToFloat32(mg.normals);
  } else if (Array.isArray(mg.normals)) {
    normals = new Float32Array(mg.normals);
  } else if (mg.normals && typeof mg.normals === 'object') {
    normals = new Float32Array(Object.values(mg.normals));
  } else {
    normals = new Float32Array(0);
  }

  let indices: Uint32Array;
  if (mg.indices instanceof Uint32Array) {
    indices = mg.indices;
  } else if (typeof mg.indices === 'string') {
    indices = base64ToUint32(mg.indices);
  } else if (Array.isArray(mg.indices)) {
    indices = new Uint32Array(mg.indices);
  } else if (mg.indices && typeof mg.indices === 'object') {
    indices = new Uint32Array(Object.values(mg.indices));
  } else {
    indices = new Uint32Array(0);
  }

  return {
    positions,
    normals,
    indices,
    color: mg.color,
    transform: mg.transform,
  };
}

export function packModel(model: BuildingModel): any {
  if (!model || !Array.isArray(model.elements)) return model;
  return {
    ...model,
    elements: model.elements.map((el) => {
      if (!el.meshGeometries || !Array.isArray(el.meshGeometries)) return el;
      return {
        ...el,
        meshGeometries: el.meshGeometries.map(packMeshGeometry),
      };
    }),
  };
}

export function unpackModel(raw: any): BuildingModel {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.elements)) return raw as BuildingModel;
  return {
    ...raw,
    elements: raw.elements.map((el: any) => {
      if (!el.meshGeometries || !Array.isArray(el.meshGeometries)) return el;
      return {
        ...el,
        meshGeometries: el.meshGeometries.map(unpackMeshGeometry),
      };
    }),
  };
}

// --- Server Cache API Calls --------------------------------------------------

const CACHE_ENDPOINT = '/api/model-cache';

export async function saveServerCache(payload: ServerCachedState): Promise<boolean> {
  try {
    const toSend: any = { ...payload };
    if (payload.model) {
      toSend.model = packModel(payload.model);
    }
    toSend.timestamp = Date.now();

    const res = await fetch(CACHE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSend),
    });
    return res.ok;
  } catch {
    // Non-fatal if offline or static preview
    return false;
  }
}

export async function loadServerCache(): Promise<ServerCachedState | null> {
  try {
    const res = await fetch(CACHE_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.cached || !json.data) return null;

    const data: ServerCachedState = json.data;
    if (data.model) {
      data.model = unpackModel(data.model);
    }
    return data;
  } catch {
    return null;
  }
}

export async function clearServerCache(): Promise<boolean> {
  try {
    const res = await fetch(CACHE_ENDPOINT, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}
