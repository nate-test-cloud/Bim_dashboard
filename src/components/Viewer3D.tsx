import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BuildingModel } from '../lib/types';

interface Props {
  model: BuildingModel;
  wireframe: boolean;
  showGrid: boolean;
  showAxes: boolean;
  visibleTypes: Record<string, boolean>;
  selectedId: string | null;
  onSelect: (id: string | null, info?: string) => void;
  autoRotate: boolean;
}

const COLORS: Record<string, number> = {
  wall: 0x3b82f6,
  window: 0x7dd3fc,
  door: 0xf59e0b,
  roof: 0x64748b,
  floor: 0x334155,
  structure: 0x8fa3bd,
  other: 0x8b5cf6,
};

interface SceneRefs {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  meshes: Map<string, THREE.Mesh>;
  struct: THREE.InstancedMesh | null;
  ray: THREE.Raycaster;
}

const structIdsOf = (s: SceneRefs): string[] =>
  (s.struct?.userData.ids as string[] | undefined) ?? [];

/**
 * Interactive Three.js viewer: orbit/zoom/pan, select, toggles, fit/reset.
 * Envelope elements are individual selectable meshes; structural parts
 * (potentially tens of thousands) render as one InstancedMesh and are
 * selectable by instance. The camera auto-fits whenever the model changes.
 */
export default function Viewer3D(p: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const selectedRef = useRef<{ mesh: THREE.Mesh | null; instance: number | null }>({
    mesh: null,
    instance: null,
  });
  const [azimuth, setAzimuth] = useState('N');
  const [error, setError] = useState<string | null>(null);
  const [structCount, setStructCount] = useState(0);
  const stateRef = useRef(p);
  stateRef.current = p;

  const fitCamera = () => {
    const s = sceneRef.current;
    if (!s) return;
    const box = new THREE.Box3();
    s.meshes.forEach((m) => {
      if (m.visible) box.expandByObject(m);
    });
    if (s.struct && s.struct.visible) {
      s.struct.computeBoundingBox();
      if (s.struct.boundingBox) box.union(s.struct.boundingBox);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
    const dirv = new THREE.Vector3(0.75, 0.55, 0.9).normalize();
    s.camera.position.copy(center).addScaledVector(dirv, size * 0.9);
    s.camera.near = Math.max(0.01, size / 10000);
    s.camera.far = size * 20 + 1000;
    s.camera.updateProjectionMatrix();
    s.controls.target.copy(center);
    s.controls.update();
  };

  // (re)build scene when model changes
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    mount.innerHTML = '';
    setError(null);
    try {
      const W = mount.clientWidth || 600;
      const H = 460;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x050a14);
      const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);
      camera.position.set(26, 20, 30);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(W, H);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      mount.appendChild(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = stateRef.current.autoRotate;
      controls.autoRotateSpeed = 0.6;

      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const dir = new THREE.DirectionalLight(0xffffff, 1.1);
      dir.position.set(40, 60, 30);
      scene.add(dir);
      const grid = new THREE.GridHelper(60, 30, 0x38bdf8, 0x1e293b);
      grid.name = 'grid';
      grid.visible = stateRef.current.showGrid;
      scene.add(grid);
      const axes = new THREE.AxesHelper(12);
      axes.name = 'axes';
      axes.visible = stateRef.current.showAxes;
      scene.add(axes);

      const meshes = new Map<string, THREE.Mesh>();
      const model = stateRef.current.model;
      const tmpMatrix = new THREE.Matrix4();
      const tmpPos = new THREE.Vector3();
      const tmpScale = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();
      let struct: THREE.InstancedMesh | null = null;

      if (model.source === 'demo-tower') {
        // Preserved abstract twisting tower from the original prototype.
        const geo = new THREE.CylinderGeometry(12, 16, 50, 24, 15);
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const yy = pos.getY(i);
          const ang = yy * 0.04;
          const x = pos.getX(i);
          const z = pos.getZ(i);
          pos.setX(i, x * Math.cos(ang) - z * Math.sin(ang));
          pos.setZ(i, x * Math.sin(ang) + z * Math.cos(ang));
        }
        geo.computeVertexNormals();
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0x1e3a8a, metalness: 0.3, roughness: 0.25,
          transparent: true, opacity: 0.85, side: THREE.DoubleSide,
          wireframe: stateRef.current.wireframe,
        });
        const tower = new THREE.Mesh(geo, mat);
        tower.userData.eid = 'tower-shell';
        scene.add(tower);
        meshes.set('tower-shell', tower);
        const core = new THREE.Mesh(
          new THREE.CylinderGeometry(4, 4, 52, 16),
          new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.7, roughness: 0.3 }),
        );
        core.userData.eid = 'tower-core';
        scene.add(core);
        meshes.set('tower-core', core);
        setStructCount(0);
      } else {
        // Structural parts → single InstancedMesh (fast for tens of thousands).
        const structEls = model.elements.filter((el) => el.category === 'structure');
        if (structEls.length) {
          const geo = new THREE.BoxGeometry(1, 1, 1);
          const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff, metalness: 0.55, roughness: 0.45,
            wireframe: stateRef.current.wireframe,
          });
          struct = new THREE.InstancedMesh(geo, mat, structEls.length);
          const c = new THREE.Color(COLORS.structure);
          const ids: string[] = [];
          structEls.forEach((el, i) => {
            const d = el.dims ?? { x: 1, y: 1, z: 1 };
            const cc = el.center ?? { x: 0, y: 0, z: 0 };
            tmpPos.set(cc.x, cc.y, cc.z);
            tmpScale.set(Math.max(d.x, 0.02), Math.max(d.y, 0.02), Math.max(d.z, 0.02));
            if (el.rotation) tmpQuat.set(el.rotation[0], el.rotation[1], el.rotation[2], el.rotation[3]);
            else tmpQuat.identity();
            tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
            struct!.setMatrixAt(i, tmpMatrix);
            struct!.setColorAt(i, c);
            ids.push(el.id);
          });
          struct.instanceMatrix.needsUpdate = true;
          if (struct.instanceColor) struct.instanceColor.needsUpdate = true;
          struct.userData.isStruct = true;
          struct.userData.ids = ids;
          struct.visible = stateRef.current.visibleTypes['structure'] !== false;
          scene.add(struct);
        }
        setStructCount(structEls.length);

        for (const el of model.elements) {
          if (el.category === 'storey' || el.category === 'space' || el.category === 'structure') continue;
          const d = el.dims ?? { x: 3, y: 2.5, z: 0.25 };
          const c = el.center ?? { x: 0, y: 2, z: 0 };
          const geo = new THREE.BoxGeometry(Math.max(d.x, 0.05), Math.max(d.y, 0.05), Math.max(d.z, 0.05));
          const isGlass = el.category === 'window';
          const mat = new THREE.MeshStandardMaterial({
            color: COLORS[el.category] ?? COLORS.other,
            transparent: isGlass,
            opacity: isGlass ? 0.55 : 0.92,
            metalness: isGlass ? 0.1 : 0.35,
            roughness: isGlass ? 0.1 : 0.55,
            wireframe: stateRef.current.wireframe,
            emissive: new THREE.Color(0x000000),
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(c.x, c.y, c.z);
          if (el.rotation) mesh.quaternion.set(el.rotation[0], el.rotation[1], el.rotation[2], el.rotation[3]);
          mesh.userData.eid = el.id;
          mesh.visible = stateRef.current.visibleTypes[el.category] !== false;
          scene.add(mesh);
          meshes.set(el.id, mesh);
        }
      }

      const ray = new THREE.Raycaster();
      const ptr = new THREE.Vector2();
      const onClick = (ev: MouseEvent) => {
        const s = sceneRef.current;
        if (!s) return;
        const rect = renderer.domElement.getBoundingClientRect();
        ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(ptr, s.camera);
        const targets: THREE.Object3D[] = [...s.meshes.values()];
        if (s.struct && s.struct.visible) targets.push(s.struct);
        const hits = ray.intersectObjects(targets);
        if (!hits.length) {
          stateRef.current.onSelect(null);
          return;
        }
        const h = hits[0];
        if ((h.object as THREE.Mesh).userData.isStruct && h.instanceId !== undefined) {
          stateRef.current.onSelect(structIdsOf(s)[h.instanceId] ?? null);
        } else {
          stateRef.current.onSelect((h.object as THREE.Mesh).userData.eid as string);
        }
      };
      renderer.domElement.addEventListener('click', onClick);

      let raf = 0;
      const animate = () => {
        raf = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
        const az = ((THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()) % 360) + 360) % 360;
        const label = az < 45 || az >= 315 ? 'N' : az < 135 ? 'E' : az < 225 ? 'S' : 'W';
        setAzimuth((prev) => (prev === label ? prev : label));
      };
      animate();

      const onResize = () => {
        const w = mount.clientWidth || 600;
        camera.aspect = w / H;
        camera.updateProjectionMatrix();
        renderer.setSize(w, H);
      };
      window.addEventListener('resize', onResize);
      sceneRef.current = { scene, camera, renderer, controls, meshes, struct, ray };
      fitCamera();
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        renderer.domElement.removeEventListener('click', onClick);
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
        });
        renderer.dispose();
        mount.innerHTML = '';
        sceneRef.current = null;
        selectedRef.current = { mesh: null, instance: null };
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : '3D viewer failed to initialize (WebGL unavailable?).');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.model]);

  // apply live toggles + selection highlight without rebuilding
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.controls.autoRotate = p.autoRotate;
    s.scene.getObjectByName('grid')!.visible = p.showGrid;
    s.scene.getObjectByName('axes')!.visible = p.showAxes;
    if (s.struct) {
      s.struct.visible = p.visibleTypes['structure'] !== false;
      (s.struct.material as THREE.MeshStandardMaterial).wireframe = p.wireframe;
    }
    // Clear previous highlight.
    const prev = selectedRef.current;
    if (prev.mesh) {
      const m = prev.mesh.material as THREE.MeshStandardMaterial;
      m.emissive = new THREE.Color(0x000000);
      m.emissiveIntensity = 0;
    }
    if (prev.instance !== null && s.struct) {
      s.struct.setColorAt(prev.instance, new THREE.Color(COLORS.structure));
      if (s.struct.instanceColor) s.struct.instanceColor.needsUpdate = true;
    }
    selectedRef.current = { mesh: null, instance: null };
    if (p.selectedId) {
      const mesh = s.meshes.get(p.selectedId) ?? null;
      if (mesh) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.emissive = new THREE.Color(0x0ea5e9);
        m.emissiveIntensity = 0.55;
        selectedRef.current = { mesh, instance: null };
      } else if (s.struct) {
        const idx = structIdsOf(s).indexOf(p.selectedId);
        if (idx >= 0) {
          s.struct.setColorAt(idx, new THREE.Color(0x0ea5e9));
          if (s.struct.instanceColor) s.struct.instanceColor.needsUpdate = true;
          selectedRef.current = { mesh: null, instance: idx };
        }
      }
    }
    s.meshes.forEach((mesh, eid) => {
      const el = p.model.elements.find((e) => e.id === eid);
      const cat = el?.category ?? 'other';
      mesh.visible = p.visibleTypes[cat] !== false;
      (mesh.material as THREE.MeshStandardMaterial).wireframe = p.wireframe;
    });
  }, [p.wireframe, p.showGrid, p.showAxes, p.visibleTypes, p.selectedId, p.autoRotate, p.model]);

  return (
    <div>
      <div className="viewer-wrap">
        <div ref={mountRef} style={{ width: '100%', height: 460 }} />
        <div className="viewer-overlay">
          Interactive BIM viewer (Three.js WebGL)
          <br />
          <span style={{ fontSize: 10 }}>Drag rotate • Scroll zoom • Right-drag pan • Click element</span>
        </div>
        <div className="viewer-tools">
          <button onClick={fitCamera}>Fit view</button>
          <button onClick={fitCamera}>Reset camera</button>
        </div>
        <div className="viewer-bottom">
          <span>
            Orientation: <strong className="mono">{azimuth}</strong>
          </span>
          <span>
            Elements: <strong className="mono">{p.model.elements.length}</strong>
            {structCount > 0 && <> (incl. {structCount} structural, instanced)</>} •{' '}
            {p.model.geometryFidelity === 'actual'
              ? 'actual geometry'
              : p.model.geometryFidelity === 'approximate'
                ? 'bounding boxes from IFC geometry'
                : 'sample geometry'}
          </span>
        </div>
      </div>
      {error && <div className="errbox">{error}</div>}
    </div>
  );
}
