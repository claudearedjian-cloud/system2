// 2D Panel CAD Viewer — Plain Canvas 2D (Safe, zero GPU dependency).
// Displays workpiece outline, drillings, edge boring aggregates, router toolpaths,
// and Pod-and-Rail reference origins (Stop 1).
import { DRILL_COLORS } from './api.js';

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
  let showOrigins = true;

  // View transform
  let view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0 };

  function px(x) {
    return view.ox + x * view.scale;
  }
  function py(y) {
    return view.oy - y * view.scale;
  }

  function computeView(width, height) {
    const cw = container.clientWidth || canvas.clientWidth || 1;
    const ch = container.clientHeight || canvas.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cw * dpr));
    canvas.height = Math.max(1, Math.floor(ch * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const pad = 52;
    const bw = Math.max(width, 1);
    const bh = Math.max(height, 1);
    const scale = Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh);
    view = {
      scale,
      ox: (cw - bw * scale) / 2,
      oy: (ch + bh * scale) / 2,
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
      drawEmpty();
      return;
    }

    const { width, height } = panel;
    computeView(width, height);

    const pts = panel.outline && panel.outline.length ? panel.outline : rect(0, 0, width, height);

    // 1. Pod-and-Rail safe clamping zones (visual hint)
    if (showOrigins) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.04)';
      ctx.fillRect(px(0), py(height), width * view.scale, height * view.scale);
    }

    // 2. Edge banding strips (behind everything)
    if (showBand && panel.edgeband && panel.edgeband.length) {
      for (const e of panel.edgeband) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
        const t = Math.max(panel.thickness * 0.4, 7);
        ctx.beginPath();
        if (e.edge === 'L') ctx.rect(px(0) - t, py(height), t, height * view.scale);
        else if (e.edge === 'R') ctx.rect(px(width), py(height), t, height * view.scale);
        else if (e.edge === 'B') ctx.rect(px(0), py(0), width * view.scale, t);
        else if (e.edge === 'T') ctx.rect(px(0), py(height) - t, width * view.scale, t);
        ctx.fill();
      }
    }

    // 3. Panel body fill
    ctx.beginPath();
    ctx.moveTo(px(pts[0].x), py(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].y));
    ctx.closePath();
    ctx.fillStyle = '#1e293b';
    ctx.fill();

    // 4. Grain direction lines
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const spacing = 28;
    if (panel.grain === 'horizontal') {
      for (let y = 0; y < height; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(px(0), py(y));
        ctx.lineTo(px(width), py(y));
        ctx.stroke();
      }
    } else if (panel.grain === 'vertical') {
      for (let x = 0; x < width; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(px(x), py(0));
        ctx.lineTo(px(x), py(height));
        ctx.stroke();
      }
    }
    ctx.restore();

    // 5. Routing / groove toolpaths
    if (showGrooves && panel.grooves && panel.grooves.length) {
      for (const g of panel.grooves) {
        if (!g.points || g.points.length < 2) continue;
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = Math.max((g.width || 6) * view.scale, 2.5);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px(g.points[0].x), py(g.points[0].y));
        for (let i = 1; i < g.points.length; i++) ctx.lineTo(px(g.points[i].x), py(g.points[i].y));
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }

    // 6. Drillings (Face and Edge)
    if (showDrills && panel.drillings && panel.drillings.length) {
      for (const d of panel.drillings) {
        const color = DRILL_COLORS[d.face] || '#ffffff';
        const r = Math.max(((d.diameter || 5) / 2) * view.scale, 2.5);

        if (d.face === 'edge') {
          // Edge boring arrow marker
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px(d.x), py(d.y), Math.max(r, 4), 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          // Face boring
          ctx.beginPath();
          ctx.arc(px(d.x), py(d.y), r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Text label for larger holes (e.g. 35mm hinge cups)
          if (d.diameter && d.diameter >= 15) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`Ø${d.diameter}`, px(d.x), py(d.y) + 3);
          }
        }
      }
    }

    // 7. Outline
    ctx.beginPath();
    ctx.moveTo(px(pts[0].x), py(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].y));
    ctx.closePath();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 8. Pod-and-Rail Origin Stop 1 Marker (Bottom-Left)
    if (showOrigins) {
      const ox = px(0);
      const oy = py(0);
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + 18, oy);
      ctx.lineTo(ox, oy - 18);
      ctx.closePath();
      ctx.fill();

      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillStyle = '#f59e0b';
      ctx.textAlign = 'left';
      ctx.fillText('STOP 1 (ORG 1)', ox + 6, oy + 16);
    }

    // 9. Dimension caption
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${fmtDim(width)} × ${fmtDim(height)} × ${fmtDim(panel.thickness)} mm`, px(width / 2), py(height) - 14);

    drawLegend();
  }

  function drawEmpty() {
    ctx.fillStyle = '#64748b';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Select a panel or scan a barcode to preview 2D tooling.', (container.clientWidth || 300) / 2, (container.clientHeight || 200) / 2);
  }

  function drawLegend() {
    const items = [
      ['Face Top Drill', DRILL_COLORS.top],
      ['Face Bottom Drill', DRILL_COLORS.bottom],
      ['Edge Aggregate Bore', DRILL_COLORS.edge],
      ['Router Groove / Dado', '#22c55e'],
      ['Edge Banding', '#94a3b8'],
      ['Stop 1 (Pod & Rail)', '#f59e0b'],
    ];
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    let y = 18;
    for (const [label, color] of items) {
      ctx.fillStyle = color;
      ctx.fillRect(12, y - 8, 10, 10);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(label, 28, y);
      y += 18;
    }
  }

  function setPanel(p, opts) {
    panel = p;
    if (opts) {
      if (typeof opts.showDrills === 'boolean') showDrills = opts.showDrills;
      if (typeof opts.showGrooves === 'boolean') showGrooves = opts.showGrooves;
      if (typeof opts.showBand === 'boolean') showBand = opts.showBand;
      if (typeof opts.showOrigins === 'boolean') showOrigins = opts.showOrigins;
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
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function fmtDim(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
}
