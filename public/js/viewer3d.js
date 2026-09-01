// 3D assembly previewer: extrudes each panel outline and places it in cabinet
// space using the placement basis computed at import time.
//
// NOTE: this file deliberately uses NO import map and NO bare-module specifiers.
// It only imports Three.js via an absolute path, and implements its own small
// orbit controls, so it loads on the widest possible range of browsers.
import * as THREE from '/vendor/three.module.js';
import { materialColor, DRILL_COLORS } from './api.js';

export function createViewer3D(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1218);
  scene.fog = new THREE.Fog(0x0b1218, 3000, 8000);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
  camera.position.set(900, 700, 1400);
  camera.up.set(0, 1, 0);

  const controls = createOrbitControls(camera, renderer.domElement);

  // Lights.
  scene.add(new THREE.AmbientLight(0x8899aa, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1000, 1800, 1200);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc9ff, 0.8);
  rim.position.set(-800, 400, -600);
  scene.add(rim);

  // Floor grid.
  const grid = new THREE.GridHelper(4000, 80, 0x2a4a5a, 0x162a35);
  scene.add(grid);

  const root = new THREE.Group();
  scene.add(root);

  const panelMeshes = new Map(); // panelId -> group

  function clear() {
    for (const [, group] of panelMeshes) {
      root.remove(group);
      disposeGroup(group);
    }
    panelMeshes.clear();
  }

  function disposeGroup(g) {
    g.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else if (obj.material) obj.material.dispose();
      }
    });
  }

  function basisMatrix(placement) {
    const u = new THREE.Vector3().fromArray(placement.uAxis);
    const v = new THREE.Vector3().fromArray(placement.vAxis);
    const t = new THREE.Vector3().fromArray(placement.thicknessAxis);
    return new THREE.Matrix4().makeBasis(u, v, t).setPosition(
      placement.origin[0], placement.origin[1], placement.origin[2],
    );
  }

  function buildPanelMesh(panel, placement, offsetX) {
    const g = new THREE.Group();

    const shape = new THREE.Shape();
    const pts = panel.outline && panel.outline.length ? panel.outline : rect(panel.width, panel.height);
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
    shape.closePath();

    const depth = panel.thickness || 18;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
    const color = new THREE.Color(materialColor(panel.material));
    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.panelId = panel.id;
    g.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 15),
      new THREE.LineBasicMaterial({ color: 0x101a22, transparent: true, opacity: 0.7 }),
    );
    g.add(edges);

    for (const d of panel.drillings || []) {
      const radius = Math.max((d.diameter || 5) / 2, 1);
      const len = Math.max(d.depth || panel.thickness || 10, 2);
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, len, 20),
        new THREE.MeshStandardMaterial({ color: DRILL_COLORS[d.face] || '#ffffff', roughness: 0.3, metalness: 0.3 }),
      );
      const z = d.face === 'bottom' ? -len / 2 : depth + len / 2;
      cyl.position.set(d.x, d.y, z);
      g.add(cyl);
    }

    if (panel.edgeband && panel.edgeband.length) {
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x5b6b78, roughness: 0.4 });
      const t = Math.max(depth * 0.08, 1);
      for (const e of panel.edgeband) {
        const box = edgeBox(e.edge, panel.width, panel.height, depth, t);
        const b = new THREE.Mesh(new THREE.BoxGeometry(box.size[0], box.size[1], box.size[2]), bandMat);
        b.position.set(box.pos[0], box.pos[1], box.pos[2]);
        g.add(b);
      }
    }

    g.applyMatrix4(basisMatrix(placement));
    g.position.x += offsetX;
    return g;
  }

  function edgeBox(edge, w, h, d, t) {
    if (edge === 'L') return { size: [t, h, d], pos: [t / 2, h / 2, d / 2] };
    if (edge === 'R') return { size: [t, h, d], pos: [w - t / 2, h / 2, d / 2] };
    if (edge === 'B') return { size: [w, t, d], pos: [w / 2, t / 2, d / 2] };
    if (edge === 'T') return { size: [w, t, d], pos: [w / 2, h - t / 2, d / 2] };
    return { size: [0, 0, 0], pos: [0, 0, 0] };
  }

  function setProject(project, opts) {
    const options = opts || {};
    clear();
    if (!project) { renderer.render(scene, camera); return; }

    const cabinets = options.cabinetId
      ? project.cabinets.filter((c) => c.id === options.cabinetId)
      : project.cabinets;

    let offsetX = 0;
    const total = new THREE.Box3();
    let any = false;

    for (const cab of cabinets) {
      const byPanel = new Map(cab.placements.map((pl) => [pl.panelId, pl]));
      let cabWidth = 0;
      for (const panel of cab.panels) {
        const pl = byPanel.get(panel.id);
        if (!pl) continue;
        const g = buildPanelMesh(panel, pl, offsetX);
        root.add(g);
        panelMeshes.set(panel.id, g);
        const bb = new THREE.Box3().setFromObject(g);
        total.union(bb);
        cabWidth = Math.max(cabWidth, panel.width);
        any = true;
      }
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
      controls.sync();
    }

    if (options.panelId) highlight(options.panelId, true);
    renderer.render(scene, camera);
  }

  function highlight(panelId, on) {
    const group = panelMeshes.get(panelId);
    if (!group) return;
    group.traverse((obj) => {
      if (obj.isMesh && obj.material && obj.material.emissive) {
        obj.material.emissive.set(on ? 0x2dd4bf : 0x000000);
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
    renderer.render(scene, camera);
  }

  function dispose() {
    clear();
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  return { setProject, highlight, resize, dispose };
}

// ---------------------------------------------------------------------------
// Minimal self-contained orbit controls (rotate / pan / zoom).
// ---------------------------------------------------------------------------
function createOrbitControls(camera, dom) {
  const target = new THREE.Vector3(300, 360, 280);
  const offset = new THREE.Vector3();
  let radius = 1000;
  let theta = 0;
  let phi = Math.PI / 3;

  const MIN_POLAR = 0.05;
  const MAX_POLAR = Math.PI - 0.05;
  const ROTATE_SPEED = 0.005;
  const ZOOM_SPEED = 0.001;

  function sync() {
    offset.copy(camera.position).sub(target);
    radius = Math.max(offset.length(), 1);
    theta = Math.atan2(offset.x, offset.z);
    phi = Math.acos(THREE.MathUtils.clamp(offset.y / radius, -1, 1));
  }

  function update() {
    const sinPhi = Math.sin(phi);
    camera.position.set(
      target.x + radius * sinPhi * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * sinPhi * Math.cos(theta),
    );
    camera.lookAt(target);
  }

  let dragging = false;
  let button = -1;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e) => {
    dragging = true;
    button = e.button;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dom.setPointerCapture) { try { dom.setPointerCapture(e.pointerId); } catch (err) {} }
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (button === 0) { // rotate
      theta -= dx * ROTATE_SPEED;
      phi -= dy * ROTATE_SPEED;
      phi = THREE.MathUtils.clamp(phi, MIN_POLAR, MAX_POLAR);
    } else { // pan
      const panScale = radius * 0.0012;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
      const up = camera.up.clone();
      target.addScaledVector(right, -dx * panScale);
      target.addScaledVector(up, dy * panScale);
    }
    update();
  };

  const onPointerUp = () => { dragging = false; button = -1; };

  const onWheel = (e) => {
    e.preventDefault();
    radius *= 1 + e.deltaY * ZOOM_SPEED;
    radius = THREE.MathUtils.clamp(radius, 20, 20000);
    update();
  };

  const onContextMenu = (e) => e.preventDefault();

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', onContextMenu);

  sync();
  update();

  return {
    target,
    sync,
    update,
    dispose() {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

function rect(w, h) {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}
