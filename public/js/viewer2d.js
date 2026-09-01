// 2D panel viewer — plain Canvas 2D (NO WebGL, no GPU, no Three.js).
//
// This renderer is deliberately dependency-free so the 2D view can never be
// frozen or blocked by graphics-driver issues on shop-floor PCs.  It draws the
// panel outline, color-coded drillings (top/bottom/edge), routing toolpaths and
// edge-banding indicators.
import { DRILL_COLORS } from './api.js';

const EDGE_LABELS = { L: 'Left', R: 'Right', B: 'Bottom', T: 'Top' };

export function createViewer2D(container) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D is not available in this browser');
  }

  let panel = null;
  let showDrills = true;
  let showGrooves = true;
  let showBand = true;

  // Panel coordinates are Y-up with origin at bottom-left; canvas is Y-down.
  // These are recomputed on each draw.
  let view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0 };

  function px(x) { return view.ox + x * view.scale; }
  function py(y) { return view.oy - y * view.scale; }

  function computeView(width, height) {
    const cw = container.clientWidth || canvas.clientWidth || 1;
    const ch = container.clientHeight || canvas.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cw * dpr));
    canvas.height = Math.max(1, Math.floor(ch * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const pad = 44;
    const bw = Math.max(width, 1);
    const bh = Math.max(height, 1);
    const scale = Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh);
    view = {
      scale: scale,
      ox: (cw - bw * scale) / 2,
      oy: (ch + bh * scale) / 2, // bottom edge of the panel in canvas coords
      w: cw,
      h: ch,
    };
  }

  function draw() {
    const cw = container.clientWidth || 1;
    const ch = container.clientHeight || 1;
    if (!panel) {
      canvas.width = Math.max(1, Math.floor(cw * (window.devicePixelRatio || 1)));
      canvas.height = Math.max(1, Math.floor(ch * (window.devicePixelRatio || 1)));
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      drawLegend();
      return;
    }

    const { width, height } = panel;
    computeView(width, height);

    const pts = panel.outline && panel.outline.length ? panel.outline : rect(0, 0, width, height);

    // Edge banding strips (behind everything).
    if (showBand && panel.edgeband && panel.edgeband.length) {
      for (const e of panel.edgeband) {
        ctx.fillStyle = 'rgba(136, 153, 170, 0.55)';
        const t = Math.max(panel.thickness * 0.35, 6); // visual thickness in px
        ctx.beginPath();
        if (e.edge === 'L') ctx.rect(px(0), py(height), t, height * view.scale);
        else if (e.edge === 'R') ctx.rect(px(width) - t, py(height), t, height * view.scale);
        else if (e.edge === 'B') ctx.rect(px(0), py(0) - t, width * view.scale, t);
        else if (e.edge === 'T') ctx.rect(px(0), py(height), width * view.scale, t);
        ctx.fill();
      }
    }

    // Panel fill.
    ctx.beginPath();
    ctx.moveTo(px(pts[0].x), py(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].y));
    ctx.closePath();
    ctx.fillStyle = '#2a3d4d';
    ctx.fill();

    // Grain direction (subtle lines).
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const spacing = 26;
    if (panel.grain === 'horizontal') {
      for (let y = 0; y < height; y += spacing) {
        ctx.beginPath(); ctx.moveTo(px(0), py(y)); ctx.lineTo(px(width), py(y)); ctx.stroke();
      }
    } else if (panel.grain === 'vertical') {
      for (let x = 0; x < width; x += spacing) {
        ctx.beginPath(); ctx.moveTo(px(x), py(0)); ctx.lineTo(px(x), py(height)); ctx.stroke();
      }
    }
    ctx.restore();

    // Routing / groove toolpaths.
    if (showGrooves && panel.grooves && panel.grooves.length) {
      for (const g of panel.grooves) {
        if (!g.points || g.points.length < 2) continue;
        ctx.strokeStyle = '#3ecf8e';
        ctx.lineWidth = Math.max((g.width || 6) * view.scale, 2);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px(g.points[0].x), py(g.points[0].y));
        for (let i = 1; i < g.points.length; i++) ctx.lineTo(px(g.points[i].x), py(g.points[i].y));
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }

    // Drillings.
    if (showDrills && panel.drillings && panel.drillings.length) {
      for (const d of panel.drillings) {
        const color = DRILL_COLORS[d.face] || '#ffffff';
        const r = Math.max((d.diameter || 5) / 2 * view.scale, 2.5);
        ctx.beginPath();
        ctx.arc(px(d.x), py(d.y), r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Outline (on top).
    ctx.beginPath();
    ctx.moveTo(px(pts[0].x), py(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].y));
    ctx.closePath();
    ctx.strokeStyle = '#dfe8f0';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Dimension caption.
    ctx.fillStyle = '#dfe8f0';
    ctx.font = '13px system-ui, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${fmtDim(width)} × ${fmtDim(height)} × ${fmtDim(panel.thickness)} mm`, px(width / 2), py(height) - 10);

    drawLegend();
  }

  function drawLegend() {
    const items = [
      ['top drill', DRILL_COLORS.top],
      ['bottom', DRILL_COLORS.bottom],
      ['edge drill', DRILL_COLORS.edge],
      ['routing', '#3ecf8e'],
      ['edge band', '#8899aa'],
    ];
    ctx.font = '12px system-ui, Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    let y = 18;
    for (const [label, color] of items) {
      ctx.fillStyle = color;
      ctx.fillRect(10, y - 7, 10, 10);
      ctx.fillStyle = '#cfe3f2';
      ctx.fillText(label, 26, y + 1);
      y += 18;
    }
  }

  function setPanel(p, opts) {
    panel = p;
    if (opts) {
      if (typeof opts.showDrills === 'boolean') showDrills = opts.showDrills;
      if (typeof opts.showGrooves === 'boolean') showGrooves = opts.showGrooves;
      if (typeof opts.showBand === 'boolean') showBand = opts.showBand;
    }
    draw();
  }

  function resize() {
    draw();
  }

  function dispose() {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return { setPanel, resize, dispose };
}

function rect(x, y, w, h) {
  return [{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }];
}

function fmtDim(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
}
