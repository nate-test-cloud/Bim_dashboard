import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BuildingModel } from '../lib/types';
import { unpackMeshGeometry } from '../lib/modelCache';

interface Props {
  model: BuildingModel;
  wireframe: boolean;
  showGrid: boolean;
  showAxes?: boolean;
  visibleTypes: Record<string, boolean>;
  hiddenElementIds?: Record<string, boolean>;
  selectedId: string | null;
  onSelect: (id: string | null, info?: string) => void;
  autoRotate: boolean;
  pickEnabled?: boolean;
  onToggleAutoRotate?: () => void;
  onToggleWireframe?: () => void;
  onToggleGrid?: () => void;
  onToggleAxes?: () => void;
}

// Architectural Monochromatic Grey Studio Palette (Distinctly greyish, never washed-out white, never black)
const COLORS: Record<string, number> = {
  wall: 0xc5c9d1,      // Solid architectural limestone / concrete grey
  window: 0x9fb0c3,    // Reflective smoked architectural glass
  door: 0xa8a49c,      // Warm medium stone / timber grey
  roof: 0x8a919e,      // Mid slate grey
  floor: 0xa4aab6,     // Structural concrete slab grey
  structure: 0x787f8d, // Solid architectural graphite steel grey (distinctly grey, never black)
  mass: 0x989fae,      // Clean medium conceptual grey
  other: 0xa2a8b5,     // Neutral auxiliary spatial grey
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

export default function Viewer3D(p: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const selectedRef = useRef<{ mesh: THREE.Mesh | null; instance: number | null }>({
    mesh: null,
    instance: null,
  });
  const [azimuth, setAzimuth] = useState('N');
  const [azimuthDeg, setAzimuthDeg] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewPreset, setViewPreset] = useState<'iso' | 'top' | 'front' | 'side' | 'custom'>('iso');
  const stateRef = useRef(p);
  stateRef.current = p;

  const getModelBounds = () => {
    const s = sceneRef.current;
    if (!s) return null;
    const box = new THREE.Box3();
    s.meshes.forEach((m) => {
      if (m.visible) box.expandByObject(m);
    });
    if (s.struct && s.struct.visible) {
      s.struct.computeBoundingBox();
      if (s.struct.boundingBox) box.union(s.struct.boundingBox);
    }
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 2);
    return { box, center, size };
  };

  const fitCamera = () => {
    const s = sceneRef.current;
    const bounds = getModelBounds();
    if (!s || !bounds) return;
    const { center, size } = bounds;
    const dirv = new THREE.Vector3(0.75, 0.55, 0.9).normalize();
    s.camera.position.copy(center).addScaledVector(dirv, size * 1.55);
    s.camera.near = Math.max(0.01, size / 10000);
    s.camera.far = size * 20 + 1000;
    s.camera.updateProjectionMatrix();
    s.controls.target.copy(center);
    s.controls.update();
    setViewPreset('iso');
  };

  const setCameraPreset = (preset: 'iso' | 'top' | 'front' | 'side') => {
    const s = sceneRef.current;
    const bounds = getModelBounds();
    if (!s || !bounds) return;
    const { center, size } = bounds;

    if (preset === 'iso') {
      const dirv = new THREE.Vector3(0.75, 0.65, 0.85).normalize();
      s.camera.position.copy(center).addScaledVector(dirv, size * 1.55);
    } else if (preset === 'top') {
      s.camera.position.set(center.x, center.y + size * 2.0, center.z + 0.001);
    } else if (preset === 'front') {
      s.camera.position.set(center.x, center.y + size * 0.25, center.z + size * 2.0);
    } else if (preset === 'side') {
      s.camera.position.set(center.x + size * 2.0, center.y + size * 0.25, center.z);
    }

    s.camera.near = Math.max(0.01, size / 10000);
    s.camera.far = size * 20 + 1000;
    s.camera.updateProjectionMatrix();
    s.controls.target.copy(center);
    s.controls.update();
    setViewPreset(preset);
  };

  // (re)build scene when model changes
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    mount.innerHTML = '';
    setError(null);
    try {
      const W = mount.clientWidth || 600;
      const H = Math.max(mount.clientHeight || 520, 480);
      const scene = new THREE.Scene();
      // Precision CAD / Architectural Studio Environment
      scene.background = new THREE.Color(0x22252a);
      scene.fog = new THREE.FogExp2(0x22252a, 0.002);

      const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);
      camera.position.set(28, 22, 34);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(W, H);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.05;

      mount.appendChild(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = stateRef.current.autoRotate;
      controls.autoRotateSpeed = 0.75;

      // Studio architectural lighting tuned for rich greyish tones
      const ambient = new THREE.AmbientLight(0x646a76, 1.35);
      scene.add(ambient);

      const hemiLight = new THREE.HemisphereLight(0xdde1e7, 0x555c68, 1.0);
      hemiLight.position.set(0, 50, 0);
      scene.add(hemiLight);

      const sun = new THREE.DirectionalLight(0xfffdfa, 1.45);
      sun.position.set(45, 65, 35);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 1024;
      sun.shadow.mapSize.height = 1024;
      scene.add(sun);

      const fillLight = new THREE.DirectionalLight(0xdfe3ea, 0.65);
      fillLight.position.set(-30, 20, -30);
      scene.add(fillLight);

      // Precision CAD Expansive Ground Grid covering the entire field
      const gridSize = 800;
      const gridDivisions = 400; // 2-unit CAD resolution across 800m field
      const halfSize = gridSize / 2;

      // Group containing full-field grid and prominent colored center axis lines
      const grid = new THREE.Group();
      grid.name = 'grid';
      grid.position.y = -0.02;
      grid.visible = stateRef.current.showGrid;

      // Subtle CAD graphite grid for the expansive field
      const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x272a31, 0x272a31);
      (gridHelper.material as THREE.LineBasicMaterial).transparent = true;
      (gridHelper.material as THREE.LineBasicMaterial).opacity = 0.85;
      (gridHelper.material as THREE.LineBasicMaterial).depthWrite = false;
      grid.add(gridHelper);

      // Dedicated ultra-crisp CAD center axes (X = Red #ef4444, Y = Yellow #facc15, Z = Green #22c55e).
      // We use slender architectural cylindrical rods (radius 0.045m = ~9cm diameter) with unlit
      // MeshBasicMaterial and depthWrite. Unlike 1px GL_LINES which suffer from subpixel anti-aliasing
      // blur when crossed by dark background grid lines, these rods rasterize with crisp MSAA polygons
      // and stay razor-sharp at any camera angle.
      const axisRadius = 0.045;
      const axesGroup = new THREE.Group();
      axesGroup.name = 'center-cad-axes';
      axesGroup.renderOrder = 3;

      // 1. X-axis (Vibrant CAD Red #ef4444, from -halfSize to +halfSize along X)
      const xGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, gridSize, 8);
      xGeo.rotateZ(-Math.PI / 2);
      const xMat = new THREE.MeshBasicMaterial({ color: 0xef4444, toneMapped: false, depthWrite: true });
      const xAxisMesh = new THREE.Mesh(xGeo, xMat);
      xAxisMesh.position.set(0, 0.02, 0);
      axesGroup.add(xAxisMesh);

      // 2. Y-axis (Vibrant CAD Yellow #facc15, from -halfSize to +halfSize along depth Z)
      const yGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, gridSize, 8);
      yGeo.rotateX(Math.PI / 2);
      const yMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, toneMapped: false, depthWrite: true });
      const yAxisMesh = new THREE.Mesh(yGeo, yMat);
      yAxisMesh.position.set(0, 0.02, 0);
      axesGroup.add(yAxisMesh);

      // 3. Z-axis (Vibrant CAD Green #22c55e, vertical elevation along Y from origin upwards)
      const zGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, halfSize, 8);
      const zMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, toneMapped: false, depthWrite: true });
      const zAxisMesh = new THREE.Mesh(zGeo, zMat);
      zAxisMesh.position.set(0, halfSize / 2, 0);
      axesGroup.add(zAxisMesh);

      grid.add(axesGroup);
      scene.add(grid);

      // World Axes Helper (hidden by default unless explicitly toggled)
      const axes = new THREE.AxesHelper(24);
      axes.name = 'axes';
      axes.setColors(new THREE.Color(0xef4444), new THREE.Color(0xfacc15), new THREE.Color(0x22c55e));
      axes.position.y = 0.01;
      axes.visible = Boolean(stateRef.current.showAxes);
      scene.add(axes);

      const meshes = new Map<string, THREE.Mesh>();
      const model = stateRef.current.model;
      const tmpMatrix = new THREE.Matrix4();
      const tmpPos = new THREE.Vector3();
      const tmpScale = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();
      let struct: THREE.InstancedMesh | null = null;

      if (model.source === 'demo-tower') {
        // High-tech twisting glass tower with corporate cobalt glaze
        const geo = new THREE.CylinderGeometry(12, 16, 50, 28, 18);
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
          color: 0x82919e,
          metalness: 0.15,
          roughness: 0.15,
          transmission: 0.65,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
          wireframe: stateRef.current.wireframe,
        });
        const tower = new THREE.Mesh(geo, mat);
        tower.userData.eid = 'tower-shell';
        scene.add(tower);
        meshes.set('tower-shell', tower);

        const core = new THREE.Mesh(
          new THREE.CylinderGeometry(4, 4, 52, 20),
          new THREE.MeshStandardMaterial({
            color: 0x94a3b8,
            metalness: 0.6,
            roughness: 0.35,
          }),
        );
        core.userData.eid = 'tower-core';
        scene.add(core);
        meshes.set('tower-core', core);
      } else if (model.elements.some((el) => el.meshGeometries && el.meshGeometries.length > 0)) {
        // High-Fidelity Real BIM Geometry from Web-IFC Engine
        const totalElements = model.elements.length;
        const isMassive = totalElements > 2000;

        // Shared materials by category to avoid tens of thousands of duplicate material allocations & uniform updates
        const sharedMaterials: Record<string, THREE.Material> = {
          window: new THREE.MeshPhysicalMaterial({
            color: COLORS.window,
            transparent: true,
            opacity: 0.65,
            roughness: 0.08,
            transmission: 0.75,
            metalness: 0.1,
            wireframe: stateRef.current.wireframe,
            side: THREE.DoubleSide,
            emissive: new THREE.Color(0x000000),
          }),
        };

        const getBaseMaterial = (cat: string) => {
          if (cat === 'window') return sharedMaterials.window;
          if (!sharedMaterials[cat]) {
            sharedMaterials[cat] = new THREE.MeshStandardMaterial({
              color: COLORS[cat] ?? COLORS.other,
              transparent: false,
              opacity: 1,
              roughness: cat === 'wall' ? 0.4 : 0.5,
              metalness: 0.04,
              wireframe: stateRef.current.wireframe,
              side: THREE.DoubleSide,
              emissive: new THREE.Color(0x000000),
            });
          }
          return sharedMaterials[cat];
        };

        for (const el of model.elements) {
          if (!el.meshGeometries || el.meshGeometries.length === 0) continue;
          const isGlass = el.category === 'window';
          const elGroup = new THREE.Group();
          elGroup.userData.eid = el.id;

          const baseMat = getBaseMaterial(el.category);

          for (const rawMg of el.meshGeometries) {
            const mg = unpackMeshGeometry(rawMg);
            if (mg.positions.length === 0) continue;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(mg.positions, 3));
            geo.setAttribute('normal', new THREE.BufferAttribute(mg.normals, 3));
            geo.setIndex(new THREE.BufferAttribute(mg.indices, 1));

            // Use shared material on massive models to allow Three.js render batching
            const mesh = new THREE.Mesh(geo, isMassive ? baseMat : baseMat.clone());
            mesh.castShadow = !isGlass && !isMassive;
            mesh.receiveShadow = !isMassive;
            mesh.userData.eid = el.id;

            // Clean architectural silhouette contour edges (only for models <= 2000 elements to avoid GPU/CPU freeze)
            if (!isMassive) {
              const edgesGeo = new THREE.EdgesGeometry(geo, 28);
              const edgesMat = new THREE.LineBasicMaterial({
                color: isGlass ? 0x94a3b8 : 0x475569,
                transparent: true,
                opacity: isGlass ? 0.45 : 0.55,
              });
              const edges = new THREE.LineSegments(edgesGeo, edgesMat);
              mesh.add(edges);
            }

            elGroup.add(mesh);
          }

          const isElHidden = Boolean(stateRef.current.hiddenElementIds?.[el.id]);
          elGroup.visible = !isElHidden && stateRef.current.visibleTypes[el.category] !== false;
          scene.add(elGroup);
          meshes.set(el.id, elGroup as unknown as THREE.Mesh);
        }
      } else {
        // Structural parts -> single InstancedMesh
        const structEls = model.elements.filter((el) => el.category === 'structure' && el.dims && el.center);
        if (structEls.length) {
          const geo = new THREE.BoxGeometry(1, 1, 1);
          const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.04,
            roughness: 0.45,
            wireframe: stateRef.current.wireframe,
          });
          struct = new THREE.InstancedMesh(geo, mat, structEls.length);
          const c = new THREE.Color(COLORS.structure);
          const ids: string[] = [];
          structEls.forEach((el, i) => {
            const d = el.dims!;
            const cc = el.center!;
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

        for (const el of model.elements) {
          if (el.category === 'storey' || el.category === 'space' || el.category === 'structure' || !el.dims || !el.center) continue;
          const d = el.dims;
          const c = el.center;
          const geo = new THREE.BoxGeometry(Math.max(d.x, 0.05), Math.max(d.y, 0.05), Math.max(d.z, 0.05));
          const isGlass = el.category === 'window';

          const mat = isGlass
            ? new THREE.MeshPhysicalMaterial({
                color: COLORS.window,
                transparent: true,
                opacity: 0.65,
                roughness: 0.08,
                transmission: 0.7,
                metalness: 0.1,
                wireframe: stateRef.current.wireframe,
                emissive: new THREE.Color(0x000000),
              })
            : new THREE.MeshStandardMaterial({
                color: COLORS[el.category] ?? COLORS.other,
                transparent: false,
                opacity: 1,
                metalness: 0.04,
                roughness: el.category === 'wall' ? 0.4 : 0.5,
                wireframe: stateRef.current.wireframe,
                emissive: new THREE.Color(0x000000),
              });

          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(c.x, c.y, c.z);
          if (el.rotation) mesh.quaternion.set(el.rotation[0], el.rotation[1], el.rotation[2], el.rotation[3]);
          mesh.userData.eid = el.id;
          const isElHidden = Boolean(stateRef.current.hiddenElementIds?.[el.id]);
          mesh.visible = !isElHidden && stateRef.current.visibleTypes[el.category] !== false;

          // Crisp CAD profile edges (Forma / Revit aesthetic)
          const edgesGeo = new THREE.EdgesGeometry(geo);
          const edgesMat = new THREE.LineBasicMaterial({
            color: isGlass ? 0x94a3b8 : 0x475569,
            transparent: true,
            opacity: isGlass ? 0.6 : 0.55,
          });
          const edges = new THREE.LineSegments(edgesGeo, edgesMat);
          mesh.add(edges);

          scene.add(mesh);
          meshes.set(el.id, mesh);
        }
      }

      const ray = new THREE.Raycaster();
      const ptr = new THREE.Vector2();

      // Click selection
      const onClick = (ev: MouseEvent) => {
        if (stateRef.current.pickEnabled === false) return;
        const s = sceneRef.current;
        if (!s) return;
        const rect = renderer.domElement.getBoundingClientRect();
        ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(ptr, s.camera);
        const targets: THREE.Object3D[] = [...s.meshes.values()];
        if (s.struct && s.struct.visible) targets.push(s.struct);
        const hits = ray.intersectObjects(targets, true);
        if (!hits.length) {
          stateRef.current.onSelect(null);
          return;
        }
        const h = hits[0];
        if ((h.object as THREE.Mesh).userData.isStruct && h.instanceId !== undefined) {
          stateRef.current.onSelect(structIdsOf(s)[h.instanceId] ?? null);
        } else {
          let cur: THREE.Object3D | null = h.object;
          let eid: string | null = null;
          while (cur && !eid) {
            if (cur.userData?.eid) eid = cur.userData.eid as string;
            cur = cur.parent;
          }
          stateRef.current.onSelect(eid);
        }
      };
      renderer.domElement.addEventListener('click', onClick);

      // Hover feedback cursor with throttling to avoid CPU thrashing on millions of triangles
      let lastMoveTime = 0;
      const onPointerMove = (ev: MouseEvent) => {
        const s = sceneRef.current;
        if (!s) return;
        if (stateRef.current.pickEnabled === false) {
          renderer.domElement.style.cursor = 'grab';
          return;
        }
        const now = performance.now();
        if (now - lastMoveTime < 60) return;
        lastMoveTime = now;
        const rect = renderer.domElement.getBoundingClientRect();
        ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(ptr, s.camera);
        const targets: THREE.Object3D[] = [...s.meshes.values()].filter((m) => m.visible);
        if (s.struct && s.struct.visible) targets.push(s.struct);
        const hits = ray.intersectObjects(targets, true);
        renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
      };
      renderer.domElement.addEventListener('pointermove', onPointerMove);

      const onPointerDown = () => {
        renderer.domElement.style.cursor = 'grabbing';
      };
      const onPointerUp = () => {
        renderer.domElement.style.cursor = 'grab';
      };
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

      let raf = 0;
      const animate = () => {
        raf = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
        const az = ((THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()) % 360) + 360) % 360;
        setAzimuthDeg(Math.round(az));
        const label =
          az < 22.5 || az >= 337.5
            ? 'N'
            : az < 67.5
              ? 'NE'
              : az < 112.5
                ? 'E'
                : az < 157.5
                  ? 'SE'
                  : az < 202.5
                    ? 'S'
                    : az < 247.5
                      ? 'SW'
                      : az < 292.5
                        ? 'W'
                        : 'NW';
        setAzimuth((prev) => (prev === label ? prev : label));
      };
      animate();

      const onResize = () => {
        const w = mount.clientWidth || 600;
        const h = mount.clientHeight || 520;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);
      sceneRef.current = { scene, camera, renderer, controls, meshes, struct, ray };
      fitCamera();

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        renderer.domElement.removeEventListener('click', onClick);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
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

  // Apply live toggles + selection highlight without rebuilding
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.controls.autoRotate = p.autoRotate;
    const gridObj = s.scene.getObjectByName('grid');
    if (gridObj) gridObj.visible = p.showGrid;
    const axesObj = s.scene.getObjectByName('axes');
    if (axesObj) axesObj.visible = Boolean(p.showAxes);

    if (s.struct) {
      s.struct.visible = p.visibleTypes['structure'] !== false;
      (s.struct.material as THREE.MeshStandardMaterial).wireframe = p.wireframe;
    }

    const setHighlight = (obj: THREE.Object3D, color: number, intensity: number) => {
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (m && m.emissive) {
            m.emissive = new THREE.Color(color);
            m.emissiveIntensity = intensity;
          }
        }
      });
    };

    // Clear previous highlight
    const prev = selectedRef.current;
    if (prev.mesh) {
      setHighlight(prev.mesh, 0x000000, 0);
    }
    if (prev.instance !== null && s.struct) {
      s.struct.setColorAt(prev.instance, new THREE.Color(COLORS.structure));
      if (s.struct.instanceColor) s.struct.instanceColor.needsUpdate = true;
    }
    selectedRef.current = { mesh: null, instance: null };

    // Highlight selected element with Blender Active Orange glow
    if (p.selectedId) {
      const mesh = s.meshes.get(p.selectedId) ?? null;
      if (mesh) {
        setHighlight(mesh, 0xea7600, 0.65);
        selectedRef.current = { mesh, instance: null };
      } else if (s.struct) {
        const idx = structIdsOf(s).indexOf(p.selectedId);
        if (idx >= 0) {
          s.struct.setColorAt(idx, new THREE.Color(0xea7600));
          if (s.struct.instanceColor) s.struct.instanceColor.needsUpdate = true;
          selectedRef.current = { mesh: null, instance: idx };
        }
      }
    }

    s.meshes.forEach((obj, eid) => {
      const el = p.model.elements.find((e) => e.id === eid);
      const cat = el?.category ?? 'other';
      const isElHidden = Boolean(p.hiddenElementIds?.[eid]);
      obj.visible = !isElHidden && p.visibleTypes[cat] !== false;
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (m && 'wireframe' in m) m.wireframe = p.wireframe;
        }
      });
    });
  }, [p.wireframe, p.showGrid, p.showAxes, p.visibleTypes, p.hiddenElementIds, p.selectedId, p.autoRotate, p.model]);

  return (
    <div className="viewer-container">
      <div className="viewer-wrap">
        <div ref={mountRef} className="viewer-canvas" style={{ width: '100%', height: '100%' }} />

        {/* Floating Precision CAD Viewport Toolbar */}
        <div className="viewer-glass-dock">
          <div className="viewer-preset-group">
            <button
              className={`dock-btn ${viewPreset === 'iso' ? 'active' : ''}`}
              onClick={() => setCameraPreset('iso')}
              title="Isometric Perspective (3D)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5"/><path d="M12 12v9"/><path d="M12 12L4 7.5"/></svg>
              <span>3D</span>
            </button>
            <button
              className={`dock-btn ${viewPreset === 'top' ? 'active' : ''}`}
              onClick={() => setCameraPreset('top')}
              title="Plan / Top View"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
              <span>Top</span>
            </button>
            <button
              className={`dock-btn ${viewPreset === 'front' ? 'active' : ''}`}
              onClick={() => setCameraPreset('front')}
              title="Elevation / Front View"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="19" x2="21" y2="19"/></svg>
              <span>Front</span>
            </button>
            <button
              className={`dock-btn ${viewPreset === 'side' ? 'active' : ''}`}
              onClick={() => setCameraPreset('side')}
              title="Profile / Side View"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14"/><line x1="2" y1="19" x2="22" y2="19"/></svg>
              <span>Side</span>
            </button>
          </div>

          <div className="dock-separator" />

          <div className="viewer-action-group">
            <button className="dock-btn" onClick={fitCamera} title="Center and Fit Viewport (F)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M3 12h3m12 0h3M12 3v3m0 12v3"/></svg>
              <span>Fit View</span>
            </button>
            <div className="dock-separator" />
            <div className="dock-meta" title="Coordinate Orientation (X: Red, Y: Yellow, Z: Cyan)">
              <span
                className="mono"
                style={{
                  fontSize: 10.5,
                  color: 'var(--text-faint)',
                  padding: '0 4px',
                  letterSpacing: '0.04em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
                  <circle cx="12" cy="14" r="1.75" fill="#e5e7eb" />
                  <line x1="12" y1="14" x2="22" y2="14" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="12" y1="14" x2="12" y2="3" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="12" y1="14" x2="4" y2="21" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                <span>{azimuth} {azimuthDeg}°</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      {error && <div className="errbox">{error}</div>}
    </div>
  );
}
