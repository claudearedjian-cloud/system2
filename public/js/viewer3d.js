// 3D assembly previewer: extrudes each panel outline and places it in cabinet
// space using the placement basis computed at import time.  OrbitControls give
// rotate / pan / zoom.
import * as THREE from '/vendor/three.module.js';
import { OrbitControls } from '/vendor/OrbitControls.js';
import { materialColor, DRILL_COLORS } from './api.js';

export function createViewer3D(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1218);
  scene.fog = new THREE.Fog(0x0b1218, 3000, 8000);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
  camera.position.set(900, 700, 1400);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(300, 360, 280);

  // Lights.
  scene.add(new THREE.AmbientLight(0x8899aa, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1000, 1800, 1200);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -2500; key.shadow.camera.right = 2500;
  key.shadow.camera.top = 2500; key.shadow.camera.bottom = -2500;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc9ff, 0.8);
  rim.position.set(-800, 400, -600);
  scene.add(rim);

  // Floor grid.
  const grid = new THREE.GridHelper(4000, 80, 0x2a4a5a, 0x162a35);
  scene.add(grid);

  const root = new THREE.Group();
  scene.add(root);

  const panelMeshes = new Map(); // panelId -> { group, materials }

  function clear() {
    for (const [, entry] of panelMeshes) {
      root.remove(entry.group);
      disposeGroup(entry.group);
    }
    panelMeshes.clear();
  }

  function disposeGroup(g) {
    g.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose();
      }
    });
  }

  function basisMatrix(placement) {
    const [ox, oy, oz] = placement.origin;
    const u = new THREE.Vector3(...placement.uAxis);
    const v = new THREE.Vector3(...placement.vAxis);
    const t = new THREE.Vector3(...placement.thicknessAxis);
    return new THREE.Matrix4().makeBasis(u, v, t).setPosition(ox, oy, oz);
  }

  function buildPanelMesh(panel, placement, offset) {
    const g = new THREE.Group();

    // Extrude outline by thickness along local Z.
    const shape = new THREE.Shape();
    const pts = panel.outline?.length ? panel.outline : rect(panel.width, panel.height);
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
    shape.closePath();

    const depth = panel.thickness || 18;
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    const color = new THREE.Color(materialColor(panel.material));
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.panelId = panel.id;
    g.add(mesh);

    // Crisp edges.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 15),
      new THREE.LineBasicMaterial({ color: 0x101a22, transparent: true, opacity: 0.7 }),
    );
    g.add(edges);

    // Drillings as small cylinders on the top face (local Z + offset).
    for (const d of panel.drillings ?? []) {
      const radius = Math.max((d.diameter || 5) / 2, 1);
      const len = Math.max(d.depth || panel.thickness || 10, 2);
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, len, 24),
        new THREE.MeshStandardMaterial({ color: DRILL_COLORS[d.face] ?? '#fff', roughness: 0.3, metalness: 0.3 }),
      );
      const z = d.face === 'bottom' ? -len / 2 : depth + len / 2;
      cyl.position.set(d.x, d.y, z);
      if (d.face === 'bottom') cyl.rotation.x = Math.PI;
      g.add(cyl);
    }

    // Edge banding tint along the panel perimeter (visual only).
    if (panel.edgeband?.length) {
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x5b6b78, roughness: 0.4 });
      const t = Math.max(depth * 0.08, 1);
      for (const e of panel.edgeband) {
        const box = edgeBox(e.edge, panel.width, panel.height, depth, t);
        const b = new THREE.Mesh(new THREE.BoxGeometry(...box.size), bandMat);
        b.position.set(...box.pos);
        g.add(b);
      }
    }

    g.applyMatrix4(basisMatrix(placement));
    g.position.add(new THREE.Vector3(offset.x, 0, 0));
    return g;
  }

  function edgeBox(edge, w, h, d, t) {
    if (edge === 'L') return { size: [t, h, d], pos: [0, h / 2, d / 2] };
    if (edge === 'R') return { size: [t, h, d], pos: [w, h / 2, d / 2] };
    if (edge === 'B') return { size: [w, t, d], pos: [w / 2, 0, d / 2] };
    if (edge === 'T') return { size: [w, t, d], pos: [w / 2, h, d / 2] };
    return { size: [0, 0, 0], pos: [0, 0, 0] };
  }

  function setProject(project, { cabinetId, panelId }) {
    clear();
    if (!project) { renderer.render(scene, camera); return; }

    const cabinets = cabinetId
      ? project.cabinets.filter((c) => c.id === cabinetId)
      : project.cabinets;

    let offsetX = 0;
    const total = new THREE.Box3();
    let any = false;

    for (const cab of cabinets) {
      const byPanel = new Map(cab.placements.map((pl) => [pl.panelId, pl]));
      for (const panel of cab.panels) {
        const pl = byPanel.get(panel.id);
        if (!pl) continue;
        const g = buildPanelMesh(panel, pl, { x: offsetX });
        root.add(g);
        panelMeshes.set(panel.id, { group: g, baseColor: materialColor(panel.material) });
        const bb = new THREE.Box3().setFromObject(g);
        total.union(bb);
        any = true;
      }
      // Space cabinets apart.
      const cabWidth = maxExtent(cab, 'x');
      offsetX += cabWidth + 180;
    }

    if (any) {
      const size = total.getSize(new THREE.Vector3());
      const center = total.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      const dist = Math.max(size.x, size.y, size.z) * 1.6;
      camera.position.set(center.x + dist * 0.9, center.y + dist * 0.7, center.z + dist);
      camera.near = Math.max(dist / 1000, 0.1);
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
    }

    if (panelId) highlight(panelId, true);
    renderer.render(scene, camera);
  }

  function maxExtent(cab, axis) {
    let m = 0;
    for (const pl of cab.placements) {
      const p = cab.panels.find((pp) => pp.id === pl.panelId);
      if (!p) continue;
      if (axis === 'x') m = Math.max(m, p.width);
      if (axis === 'y') m = Math.max(m, p.height);
      if (axis === 'z') m = Math.max(m, p.height);
    }
    return m;
  }

  function highlight(panelId, on) {
    const entry = panelMeshes.get(panelId);
    if (!entry) return;
    entry.group.traverse((obj) => {
      if (obj.isMesh && obj.material?.color && obj.material?.type !== 'LineBasicMaterial') {
        obj.material.emissive = new THREE.Color(on ? 0x2dd4bf : 0x000000);
        obj.material.emissiveIntensity = on ? 0.55 : 0;
      }
    });
    renderer.render(scene, camera);
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let raf = null;
  function animate() {
    raf = requestAnimationFrame(animate);
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      controls.update();
      renderer.render(scene, camera);
    }
  }
  animate();

  function dispose() {
    cancelAnimationFrame(raf);
    clear();
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setProject, highlight, resize, dispose };
}

function rect(w, h) {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}
