// 3D Interactive Assembly Viewer (Module D: Component Highlighter & Assembly Tracking).
// Extrudes panel geometry, places in cabinet world space, supports real-time
// pulsating part highlighting, exploded views, ghosting, and touch orbit controls.
import * as THREE from '/vendor/three.module.js';
import { materialColor, DRILL_COLORS } from './api.js';

export function createViewer3D(container, options = {}) {
  // Test if WebGL is available in the current browser/VM environment
  let renderer;
  try {
    const testCanvas = document.createElement('canvas');
    const gl =
      testCanvas.getContext('webgl2') ||
      testCanvas.getContext('webgl') ||
      testCanvas.getContext('experimental-webgl');
    if (!gl) {
      throw new Error('WebGL context is not supported or 3D acceleration is disabled.');
    }
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
  } catch (err) {
    console.warn('[viewer3d] WebGL unavailable in this VM/environment:', err.message);
    container.innerHTML = `
      <div class="empty-hint" style="color:var(--text-dim); padding:24px; text-align:center;">
        <div style="font-size:32px; margin-bottom:8px">🖥️</div>
        <div style="font-weight:700; font-size:14px; color:var(--text); margin-bottom:6px">3D Graphics Acceleration Disabled in VM</div>
        <div style="font-size:12px; max-width:380px; margin:0 auto 12px; line-height:1.4">
          VMware 3D graphics acceleration is turned off. All other features (Assembly Checklist, 2D Tooling Viewer, CNC Station, Cut Rite Saw, and Barcode Scans) are fully operational.
        </div>
      </div>
    `;
    return {
      setProject() {},
      highlight() {},
      setExplode() {},
      setGhostMode() {},
      resetView() {},
      setPanelCallback() {},
      resize() {},
      dispose() {},
      render() {},
    };
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c141c);
  scene.fog = new THREE.Fog(0x0c141c, 2500, 7500);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
  camera.position.set(900, 700, 1400);
  camera.up.set(0, 1, 0);

  const controls = createOrbitControls(camera, renderer.domElement);

  // Lighting
  const ambient = new THREE.AmbientLight(0x94a3b8, 1.5);
  scene.add(ambient);

  const mainLight = new THREE.DirectionalLight(0xffffff, 2.0);
  mainLight.position.set(1200, 2000, 1400);
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.8);
  fillLight.position.set(-1200, 600, -800);
  scene.add(fillLight);

  const backLight = new THREE.DirectionalLight(0xa78bfa, 0.6);
  backLight.position.set(0, -800, 1000);
  scene.add(backLight);

  // Floor grid
  const grid = new THREE.GridHelper(3000, 60, 0x1e3a5f, 0x112233);
  grid.position.y = -2;
  scene.add(grid);

  const root = new THREE.Group();
  scene.add(root);

  // State
  const panelNodes = new Map();
  let activePanelId = null;
  let explodeFactor = 0;
  let isGhostMode = false;
  let animFrameId = null;
  let pulseStartTime = 0;
  let onPanelSelectCallback = options.onPanelSelect || null;

  function clear() {
    for (const [, node] of panelNodes) {
      root.remove(node.group);
      disposeGroup(node.group);
    }
    panelNodes.clear();
    activePanelId = null;
  }

  function disposeGroup(g) {
    g.traverse((obj) => {
      if (obj.isMesh || obj.isLineSegments) {
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
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    const col = new THREE.Color(materialColor(panel.material));

    const mat = new THREE.MeshStandardMaterial({
      color: col,
      roughness: 0.5,
      metalness: 0.05,
      transparent: true,
      opacity: 1.0,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.0,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { panelId: panel.id, partCode: panel.partCode, panelName: panel.name };
    g.add(mesh);

    // Subtle edge wireframe
    const edgesGeo = new THREE.EdgesGeometry(geo, 15);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.75, linewidth: 1 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    g.add(edges);

    // Drillings in 3D
    for (const d of panel.drillings || []) {
      const radius = Math.max((d.diameter || 5) / 2, 1.2);
      const len = Math.max(d.depth || panel.thickness || 10, 2);
      const dColor = DRILL_COLORS[d.face] || '#ffffff';
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, len, 16),
        new THREE.MeshStandardMaterial({ color: dColor, roughness: 0.3, metalness: 0.2 }),
      );
      if (d.face === 'edge') {
        cyl.position.set(d.x, d.y, depth / 2);
      } else {
        const z = d.face === 'bottom' ? -len / 2 : depth + len / 2;
        cyl.position.set(d.x, d.y, z);
      }
      g.add(cyl);
    }

    // Edge banding
    if (panel.edgeband && panel.edgeband.length) {
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4 });
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

    const initialPos = g.position.clone();
    const explodeDir = placement.explodeVector
      ? new THREE.Vector3().fromArray(placement.explodeVector)
      : new THREE.Vector3(0, 0, 0);

    return { group: g, mesh, mat, edges, initialPos, explodeDir, panel, placement };
  }

  function edgeBox(edge, w, h, d, t) {
    if (edge === 'L') return { size: [t, h, d], pos: [t / 2, h / 2, d / 2] };
    if (edge === 'R') return { size: [t, h, d], pos: [w - t / 2, h / 2, d / 2] };
    if (edge === 'B') return { size: [w, t, d], pos: [w / 2, t / 2, d / 2] };
    if (edge === 'T') return { size: [w, t, d], pos: [w / 2, h - t / 2, d / 2] };
    return { size: [0, 0, 0], pos: [0, 0, 0] };
  }

  function setProject(project, opts = {}) {
    clear();
    if (!project) {
      render();
      return;
    }

    const cabinets = opts.cabinetId
      ? project.cabinets.filter((c) => c.id === opts.cabinetId)
      : project.cabinets;

    let offsetX = 0;
    const totalBounds = new THREE.Box3();
    let hasPanels = false;

    for (const cab of cabinets) {
      const byPanel = new Map(cab.placements.map((pl) => [pl.panelId, pl]));
      let cabWidth = cab.width || 0;

      for (const panel of cab.panels) {
        const pl = byPanel.get(panel.id);
        if (!pl) continue;
        const node = buildPanelMesh(panel, pl, offsetX);
        root.add(node.group);
        panelNodes.set(panel.id, node);

        const bb = new THREE.Box3().setFromObject(node.group);
        totalBounds.union(bb);
        cabWidth = Math.max(cabWidth, panel.width);
        hasPanels = true;
      }
      offsetX += cabWidth + 240;
    }

    if (hasPanels) {
      const size = totalBounds.getSize(new THREE.Vector3());
      const center = totalBounds.getCenter(new THREE.Vector3());
      controls.target.copy(center);

      const maxDim = Math.max(size.x, size.y, size.z, 200);
      const dist = maxDim * 1.7;
      camera.position.set(center.x + dist * 0.8, center.y + dist * 0.65, center.z + dist * 1.1);
      camera.near = Math.max(dist / 1000, 1);
      camera.far = dist * 25;
      camera.updateProjectionMatrix();
      controls.sync();
    }

    if (opts.panelId) {
      highlight(opts.panelId, true);
    } else {
      updateVisualMaterials();
    }

    render();
  }

  function setExplode(factor) {
    explodeFactor = Math.max(0, Math.min(factor, 1));
    const distance = 140 * explodeFactor;

    for (const [, node] of panelNodes) {
      const shift = node.explodeDir.clone().multiplyScalar(distance);
      node.group.position.copy(node.initialPos).add(shift);
    }
    render();
  }

  function setGhostMode(enabled) {
    isGhostMode = Boolean(enabled);
    updateVisualMaterials();
    render();
  }

  function updateVisualMaterials() {
    const hasHighlight = Boolean(activePanelId);

    for (const [id, node] of panelNodes) {
      const isTarget = id === activePanelId;
      const baseCol = new THREE.Color(materialColor(node.panel.material));

      if (isTarget) {
        node.mat.opacity = 0.95;
        node.mat.color.set(0x22c55e);
        node.mat.emissive.set(0x22c55e);
        node.mat.emissiveIntensity = 0.7;
        node.mat.roughness = 0.2;
        node.edges.material.opacity = 1.0;
        node.edges.material.color.set(0xffffff);
      } else if (hasHighlight && isGhostMode) {
        node.mat.opacity = 0.18;
        node.mat.color.set(baseCol).multiplyScalar(0.7);
        node.mat.emissive.set(0x000000);
        node.mat.emissiveIntensity = 0;
        node.mat.roughness = 0.8;
        node.edges.material.opacity = 0.25;
        node.edges.material.color.set(0x475569);
      } else if (hasHighlight) {
        node.mat.opacity = 0.85;
        node.mat.color.set(baseCol);
        node.mat.emissive.set(0x000000);
        node.mat.emissiveIntensity = 0;
        node.mat.roughness = 0.5;
        node.edges.material.opacity = 0.6;
        node.edges.material.color.set(0x1e293b);
      } else {
        node.mat.opacity = 1.0;
        node.mat.color.set(baseCol);
        node.mat.emissive.set(0x000000);
        node.mat.emissiveIntensity = 0;
        node.mat.roughness = 0.5;
        node.edges.material.opacity = 0.7;
        node.edges.material.color.set(0x0f172a);
      }
    }
  }

  function highlight(panelId, on = true) {
    if (on && panelId) {
      activePanelId = panelId;
      pulseStartTime = performance.now();
      startPulseAnimation();
    } else {
      activePanelId = null;
      stopPulseAnimation();
    }
    updateVisualMaterials();
    render();
  }

  function startPulseAnimation() {
    if (animFrameId) return;

    function loop(now) {
      if (!activePanelId) {
        animFrameId = null;
        return;
      }

      const elapsed = (now - pulseStartTime) / 1000;
      const pulse = 0.55 + 0.45 * Math.sin(elapsed * 5.0);

      const target = panelNodes.get(activePanelId);
      if (target) {
        target.mat.emissiveIntensity = pulse * 0.9;
        target.mat.color.setRGB(0.12 + 0.1 * pulse, 0.75 + 0.25 * pulse, 0.4 + 0.3 * pulse);
      }

      render();
      animFrameId = requestAnimationFrame(loop);
    }

    animFrameId = requestAnimationFrame(loop);
  }

  function stopPulseAnimation() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onPointerClick(event) {
    const rectBounds = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rectBounds.left) / rectBounds.width) * 2 - 1;
    mouse.y = -((event.clientY - rectBounds.top) / rectBounds.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const meshes = [...panelNodes.values()].map((n) => n.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
      const pid = hits[0].object.userData.panelId;
      if (pid) {
        highlight(pid, true);
        if (onPanelSelectCallback) onPanelSelectCallback(pid);
      }
    }
  }

  renderer.domElement.addEventListener('click', onPointerClick);

  function render() {
    renderer.render(scene, camera);
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }

  function resetView() {
    const totalBounds = new THREE.Box3();
    let any = false;
    for (const [, node] of panelNodes) {
      totalBounds.union(new THREE.Box3().setFromObject(node.group));
      any = true;
    }
    if (any) {
      const size = totalBounds.getSize(new THREE.Vector3());
      const center = totalBounds.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      const maxDim = Math.max(size.x, size.y, size.z, 200);
      const dist = maxDim * 1.7;
      camera.position.set(center.x + dist * 0.8, center.y + dist * 0.65, center.z + dist * 1.1);
      camera.updateProjectionMatrix();
      controls.sync();
      render();
    }
  }

  function setPanelCallback(cb) {
    onPanelSelectCallback = cb;
  }

  function dispose() {
    stopPulseAnimation();
    clear();
    controls.dispose();
    renderer.dispose();
    renderer.domElement.removeEventListener('click', onPointerClick);
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  return {
    setProject,
    highlight,
    setExplode,
    setGhostMode,
    resetView,
    setPanelCallback,
    resize,
    dispose,
    render,
  };
}

function createOrbitControls(camera, dom) {
  const target = new THREE.Vector3(300, 360, 280);
  const offset = new THREE.Vector3();
  let radius = 1000;
  let theta = 0;
  let phi = Math.PI / 3;

  const MIN_POLAR = 0.05;
  const MAX_POLAR = Math.PI - 0.05;
  const ROTATE_SPEED = 0.005;
  const ZOOM_SPEED = 0.0012;

  function sync() {
    offset.copy(camera.position).sub(target);
    radius = Math.max(offset.length(), 10);
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
  let touchStartDist = 0;

  const onPointerDown = (e) => {
    dragging = true;
    button = e.button !== undefined ? e.button : 0;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dom.setPointerCapture) {
      try { dom.setPointerCapture(e.pointerId); } catch {}
    }
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (button === 0) {
      theta -= dx * ROTATE_SPEED;
      phi -= dy * ROTATE_SPEED;
      phi = THREE.MathUtils.clamp(phi, MIN_POLAR, MAX_POLAR);
    } else {
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

  const onPointerUp = () => {
    dragging = false;
    button = -1;
  };

  const onWheel = (e) => {
    e.preventDefault();
    radius *= 1 + e.deltaY * ZOOM_SPEED;
    radius = THREE.MathUtils.clamp(radius, 50, 20000);
    update();
  };

  const onTouchStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDist = Math.hypot(dx, dy);
    }
  };

  const onTouchMove = (e) => {
    if (e.touches && e.touches.length === 2 && touchStartDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const diff = touchStartDist - dist;
      touchStartDist = dist;
      radius *= 1 + diff * 0.005;
      radius = THREE.MathUtils.clamp(radius, 50, 20000);
      update();
    }
  };

  const onContextMenu = (e) => e.preventDefault();

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('touchstart', onTouchStart, { passive: true });
  dom.addEventListener('touchmove', onTouchMove, { passive: true });
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
      dom.removeEventListener('touchstart', onTouchStart);
      dom.removeEventListener('touchmove', onTouchMove);
      dom.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

function rect(w, h) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}
