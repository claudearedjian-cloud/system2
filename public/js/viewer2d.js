// 2D panel viewer: orthographic top view of a single panel with color-coded
// drillings (top/bottom/edge), routing toolpaths and edge-banding indicators.
import * as THREE from '/vendor/three.module.js';
import { DRILL_COLORS } from './api.js';

const EDGE_NAMES = { L: 'Left', R: 'Right', B: 'Bottom', T: 'Top' };

export function createViewer2D(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1218);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);

  const grid = new THREE.GridHelper(1000, 100, 0x1c3a4a, 0x13232d);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  const group = new THREE.Group();
  scene.add(group);

  // Legend sprite (canvas) — bottom-left.
  let legend = makeLegend();
  legend.position.set(0, 0, 0.5);
  scene.add(legend);

  function makeLegend() {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(13,20,25,0.85)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#2a3c4a';
    ctx.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
    ctx.font = '13px system-ui';
    const items = [
      ['top drill', DRILL_COLORS.top],
      ['bottom drill', DRILL_COLORS.bottom],
      ['edge drill', DRILL_COLORS.edge],
      ['routing', '#3ecf8e'],
      ['edge band', '#8899aa'],
    ];
    items.forEach(([label, color], i) => {
      const x = 14 + (i % 2) * 160;
      const y = 24 + Math.floor(i / 2) * 30;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cfe3f2';
      ctx.fillText(label, x + 14, y + 5);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(2.2, 0.66, 1);
    return sp;
  }

  let panel = null;

  function clear() {
    while (group.children.length) {
      const child = group.children.pop();
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose();
    }
  }

  function fit(width, height) {
    const cw = container.clientWidth || 1;
    const ch = container.clientHeight || 1;
    renderer.setSize(cw, ch, false);
    const pad = 40;
    const viewW = Math.max(width + pad * 2, 1);
    const viewH = Math.max(height + pad * 2, 1);
    const aspect = cw / Math.max(ch, 1);
    let hw, hh;
    if (viewW / viewH > aspect) {
      hw = viewW / 2;
      hh = hw / aspect;
    } else {
      hh = viewH / 2;
      hw = hh * aspect;
    }
    camera.left = -hw; camera.right = hw;
    camera.top = hh; camera.bottom = -hh;
    camera.position.set(width / 2, height / 2, 100);
    camera.lookAt(width / 2, height / 2, 0);
    camera.updateProjectionMatrix();
    // Grid scale to panel size.
    const gs = Math.max(width, height) * 1.6;
    grid.scale.set(gs / 1000, gs / 1000, 1);
    grid.position.set(width / 2, height / 2, -0.1);
  }

  function setPanel(p, opts = {}) {
    panel = p;
    clear();
    const show = { drills: opts.showDrills ?? true, grooves: opts.showGrooves ?? true, band: opts.showBand ?? true };
    if (!p) { renderer.render(scene, camera); return; }

    const { width, height } = p;

    // Outline (filled + edge).
    const shape = new THREE.Shape();
    const pts = p.outline?.length ? p.outline : rect(0, 0, width, height);
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
    shape.closePath();

    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0x243443, side: THREE.DoubleSide }),
    );
    fill.position.z = 0;
    group.add(fill);

    const outline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts.map((q) => new THREE.Vector3(q.x, q.y, 0.05))),
      new THREE.LineBasicMaterial({ color: 0xdfe8f0 }),
    );
    group.add(outline);

    // Edge banding (rectangular panels).
    if (show.band && p.edgeband?.length) {
      const bandColor = 0x8899aa;
      const t = Math.max(p.thickness * 0.12, 2);
      for (const e of p.edgeband) {
        const geo = bandGeometry(e.edge, width, height, t);
        if (geo) group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: bandColor })));
      }
    }

    // Grooves / routing toolpaths.
    for (const g of show.grooves ? (p.grooves ?? []) : []) {
      if (g.points.length < 2) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(g.points.map((q) => new THREE.Vector3(q.x, q.y, 0.1))),
        new THREE.LineBasicMaterial({ color: 0x3ecf8e }),
      );
      group.add(line);
      if (g.width) {
        const dash = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(
            g.points.map((q) => new THREE.Vector3(q.x + g.width / 2, q.y, 0.1)),
          ),
          new THREE.LineBasicMaterial({ color: 0x2b8f63 }),
        );
        group.add(dash);
      }
    }

    // Drillings.
    for (const d of show.drills ? (p.drillings ?? []) : []) {
      const color = DRILL_COLORS[d.face] ?? '#ffffff';
      const radius = Math.max((d.diameter || 5) / 2, 1.5);
      const circle = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 40),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      circle.position.set(d.x, d.y, 0.2);
      group.add(circle);
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 40 }, (_, i) => {
            const a = (i / 40) * Math.PI * 2;
            return new THREE.Vector3(d.x + radius * Math.cos(a), d.y + radius * Math.sin(a), 0.21);
          }),
        ),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
      );
      group.add(ring);
    }

    // Dimensions annotation.
    const dimLabel = makeTextSprite(`${fmtDim(width)} × ${fmtDim(height)} mm`, '#dfe8f0');
    dimLabel.position.set(width / 2, height + 24, 1);
    dimLabel.scale.set(Math.max(width, 60), 14, 1);
    group.add(dimLabel);

    fit(width, height);
    renderer.render(scene, camera);
  }

  function bandGeometry(edge, width, height, t) {
    const shape = new THREE.Shape();
    if (edge === 'L') {
      shape.moveTo(0, 0); shape.lineTo(t, 0); shape.lineTo(t, height); shape.lineTo(0, height);
    } else if (edge === 'R') {
      shape.moveTo(width - t, 0); shape.lineTo(width, 0); shape.lineTo(width, height); shape.lineTo(width - t, height);
    } else if (edge === 'B') {
      shape.moveTo(0, 0); shape.lineTo(width, 0); shape.lineTo(width, t); shape.lineTo(0, t);
    } else if (edge === 'T') {
      shape.moveTo(0, height - t); shape.lineTo(width, height - t); shape.lineTo(width, height); shape.lineTo(0, height);
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }

  function makeTextSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '600 40px system-ui';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    if (panel) fit(panel.width, panel.height);
    else renderer.render(scene, camera);
  }

  function dispose() {
    clear();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setPanel, resize, dispose };
}

function rect(x, y, w, h) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

function fmtDim(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
}
