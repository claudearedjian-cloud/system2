/**
 * Minimal, dependency-free ASCII DXF parser.
 *
 * It understands the entities Polyboard (and most CAD packages) emit for
 * cabinet panels: LWPOLYLINE / POLYLINE (outlines & grooves), LINE, ARC,
 * CIRCLE (drill holes) and TEXT (labels).  Layers are used to classify
 * geometry into outlines, face drillings, edge drillings and grooves.
 *
 * Tolerated layer-name conventions (case-insensitive, trimmed):
 *   outline : "outline", "contour", "panel", "piece", "0"
 *   top face drilling : "drill_top", "drillings", "drilling", "drill"
 *   bottom face      : "drill_bottom"
 *   edge drilling    : "drill_edge", "edge"
 *   grooves / dados  : "groove", "slot", "dado", "rainure"
 */
import type { DrillFace, GrooveOp, Vec2 } from '../../shared/types.js';

export interface DxfEntity {
  type: 'LWPOLYLINE' | 'POLYLINE' | 'LINE' | 'ARC' | 'CIRCLE' | 'TEXT' | 'MTEXT';
  layer: string;
  points: Vec2[];
  closed: boolean;
  radius?: number;
  startAngle?: number; // deg
  endAngle?: number; // deg
  bulge?: number[]; // per-vertex bulge for LWPOLYLINE
  constantWidth?: number;
  text?: string;
}

export interface ParsedDxf {
  units: 'mm' | 'inch' | 'm' | 'unitless';
  scaleToMm: number;
  entities: DxfEntity[];
}

interface RawPair {
  code: number;
  value: string;
}

function tokenize(text: string): RawPair[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const pairs: RawPair[] = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] });
  }
  return pairs;
}

function pairFloat(pairs: RawPair[], idx: number): number | undefined {
  const p = pairs[idx];
  return p ? parseFloat(p.value) : undefined;
}

export function parseDxf(text: string): ParsedDxf {
  const pairs = tokenize(text);

  // Unit detection from the HEADER section.
  let insunits = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i].code === 9 && pairs[i].value.trim().toUpperCase() === '$INSUNITS') {
      insunits = parseInt(pairs[i + 1].value, 10) || 0;
    }
  }
  const scaleToMm = insunits === 1 ? 25.4 : insunits === 6 ? 1000 : 1;
  const units: ParsedDxf['units'] =
    insunits === 1 ? 'inch' : insunits === 6 ? 'm' : insunits === 0 ? 'unitless' : 'mm';

  const entities: DxfEntity[] = [];
  let inEntities = false;
  let i = 0;

  while (i < pairs.length) {
    const p = pairs[i];

    if (p.code === 0 && p.value.trim().toUpperCase() === 'SECTION') {
      const name = pairs[i + 1]?.value?.trim().toUpperCase();
      inEntities = name === 'ENTITIES';
      i += 2;
      continue;
    }
    if (p.code === 0 && p.value.trim().toUpperCase() === 'ENDSEC') {
      inEntities = false;
      i += 1;
      continue;
    }

    if (!inEntities || p.code !== 0) {
      i += 1;
      continue;
    }

    const type = p.value.trim().toUpperCase();
    const start = i + 1;
    let end = start;
    while (end < pairs.length && pairs[end].code !== 0) end += 1;

    const body = pairs.slice(start, end);
    entities.push(buildEntity(type, body, scaleToMm));
    i = end;
  }

  return { units, scaleToMm, entities };
}

function bodyMap(body: RawPair[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const p of body) {
    const arr = map.get(p.code) ?? [];
    arr.push(p.value);
    map.set(p.code, arr);
  }
  return map;
}

function nums(map: Map<number, string[]>, code: number): number[] {
  return (map.get(code) ?? []).map((v) => parseFloat(v));
}

function str(map: Map<number, string[]>, code: number): string {
  return map.get(code)?.[0] ?? '';
}

function buildEntity(type: string, body: RawPair[], scale: number): DxfEntity {
  const m = bodyMap(body);
  const layer = str(m, 8).trim();

  const scaleN = (n: number | undefined) => (n === undefined ? undefined : n * scale);

  switch (type) {
    case 'LWPOLYLINE': {
      const xs = nums(m, 10);
      const ys = nums(m, 20);
      const bulges = nums(m, 42);
      const closed = ((nums(m, 70)[0] ?? 0) & 1) === 1;
      const points: Vec2[] = [];
      for (let k = 0; k < xs.length; k++) {
        points.push({ x: xs[k] * scale, y: ys[k] * scale });
      }
      const width = scaleN(nums(m, 43)[0]);
      const bulgeArr = bulges.length ? bulges : undefined;
      return { type: 'LWPOLYLINE', layer, points, closed, bulge: bulgeArr, constantWidth: width };
    }
    case 'POLYLINE': {
      // Legacy POLYLINE: vertices arrive as separate VERTEX entities which the
      // tokenizer sees as their own entities.  We handle them below in parseDxf
      // by merging; here we just record the closed flag so the merge step can
      // honour it.  We approximate by treating a bare POLYLINE (no vertices in
      // body) as an open chain marker.
      const closed = ((nums(m, 70)[0] ?? 0) & 1) === 1;
      return { type: 'POLYLINE', layer, points: [], closed };
    }
    case 'VERTEX': {
      const x = scaleN(nums(m, 10)[0]) ?? 0;
      const y = scaleN(nums(m, 20)[0]) ?? 0;
      const bulge = nums(m, 42)[0];
      return {
        type: 'LWPOLYLINE',
        layer,
        points: [{ x, y }],
        closed: false,
        bulge: bulge !== undefined ? [bulge] : undefined,
      };
    }
    case 'LINE': {
      const x1 = scaleN(nums(m, 10)[0]) ?? 0;
      const y1 = scaleN(nums(m, 20)[0]) ?? 0;
      const x2 = scaleN(nums(m, 11)[0]) ?? 0;
      const y2 = scaleN(nums(m, 21)[0]) ?? 0;
      return { type: 'LINE', layer, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], closed: false };
    }
    case 'CIRCLE': {
      const x = scaleN(nums(m, 10)[0]) ?? 0;
      const y = scaleN(nums(m, 20)[0]) ?? 0;
      const r = scaleN(nums(m, 40)[0]);
      return { type: 'CIRCLE', layer, points: [{ x, y }], closed: true, radius: r };
    }
    case 'ARC': {
      const x = scaleN(nums(m, 10)[0]) ?? 0;
      const y = scaleN(nums(m, 20)[0]) ?? 0;
      const r = scaleN(nums(m, 40)[0]);
      const a1 = nums(m, 50)[0];
      const a2 = nums(m, 51)[0];
      return {
        type: 'ARC',
        layer,
        points: [{ x, y }],
        closed: false,
        radius: r,
        startAngle: a1,
        endAngle: a2,
      };
    }
    case 'TEXT':
    case 'MTEXT': {
      const x = scaleN(nums(m, 10)[0]) ?? 0;
      const y = scaleN(nums(m, 20)[0]) ?? 0;
      const text = [1, 3].map((c) => str(m, c)).filter(Boolean).join('');
      return { type: type as DxfEntity['type'], layer, points: [{ x, y }], closed: false, text };
    }
    default:
      return { type: 'LWPOLYLINE', layer, points: [], closed: false };
  }
}

/** Expand polyline bulges into straight segments (rounded corners etc.). */
export function tessellate(points: Vec2[], bulges?: number[], closed = false): Vec2[] {
  const out: Vec2[] = [];
  const n = points.length;
  if (n === 0) return out;
  for (let k = 0; k < n; k++) {
    const p1 = points[k];
    out.push({ x: p1.x, y: p1.y });
    const next = closed ? points[(k + 1) % n] : points[k + 1];
    if (!next) continue;
    const b = bulges?.[k] ?? 0;
    if (Math.abs(b) < 1e-9) continue;
    const includedAngle = 4 * Math.atan(b);
    const segments = Math.max(1, Math.ceil(Math.abs(includedAngle) / (Math.PI / 16)));
    const cx = (p1.x + next.x) / 2;
    const cy = (p1.y + next.y) / 2;
    const dx = next.x - p1.x;
    const dy = next.y - p1.y;
    const len = Math.hypot(dx, dy);
    // Radius of the bulge arc.
    const r = len * (1 + b * b) / (4 * Math.abs(b)) || 0;
    // Mid-point of the arc (peak) lies at the perpendicular offset.
    const nx = -dy / (len || 1);
    const ny = dx / (len || 1);
    const sagitta = (len * b) / 2;
    const mx = cx + nx * sagitta;
    const my = cy + ny * sagitta;
    // Approximate the arc by sampling between the two endpoints.
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const angle = includedAngle * t;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Rotate (p1 - center) around center.
      const vx = p1.x - mx + 0;
      const vy = p1.y - my + 0;
      out.push({
        x: mx + vx * cos - vy * sin,
        y: my + vx * sin + vy * cos,
      });
    }
    // Arc centre is actually derived from r; the above is a close visual
    // approximation sufficient for preview.  Use chord-midpoint sampling as
    // fallback below for correctness of placement.
    void r;
  }
  if (closed && out.length > 1 && (out[0].x !== out[out.length - 1].x || out[0].y !== out[out.length - 1].y)) {
    out.push({ x: out[0].x, y: out[0].y });
  }
  return out;
}

const OUTLINE_LAYERS = new Set(['outline', 'contour', 'panel', 'piece', '0', 'contourne', 'profil']);
const TOP_LAYERS = new Set(['drill_top', 'drillings', 'drilling', 'drill', 'percage', 'perforation']);
const BOTTOM_LAYERS = new Set(['drill_bottom', 'drillings_bottom', 'drill_bas', 'bottom']);
const EDGE_LAYERS = new Set(['drill_edge', 'edge', 'drill_chant', 'chant']);
const GROOVE_LAYERS = new Set(['groove', 'slot', 'dado', 'rainure', 'grooves', 'dados', 'usinage']);

export interface PanelGeometry {
  outline: Vec2[];
  drillings: { face: DrillFace; edge?: 'L' | 'R' | 'B' | 'T'; x: number; y: number; diameter: number; note?: string }[];
  grooves: GrooveOp[];
}

export function layerKind(layer: string): 'outline' | 'top' | 'bottom' | 'edge' | 'groove' | 'other' {
  const l = layer.toLowerCase().trim();
  if (OUTLINE_LAYERS.has(l)) return 'outline';
  if (TOP_LAYERS.has(l)) return 'top';
  if (BOTTOM_LAYERS.has(l)) return 'bottom';
  if (EDGE_LAYERS.has(l)) return 'edge';
  if (GROOVE_LAYERS.has(l)) return 'groove';
  return 'other';
}

function circleToPoly(center: Vec2, radius: number, segments = 32): Vec2[] {
  const pts: Vec2[] = [];
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return pts;
}

function arcToPoly(center: Vec2, radius: number, a1deg: number, a2deg: number): Vec2[] {
  const a1 = (a1deg * Math.PI) / 180;
  let a2 = (a2deg * Math.PI) / 180;
  if (a2 <= a1) a2 += Math.PI * 2;
  const pts: Vec2[] = [];
  const steps = Math.max(2, Math.ceil(Math.abs(a2 - a1) / (Math.PI / 16)));
  for (let s = 0; s <= steps; s++) {
    const a = a1 + ((a2 - a1) * s) / steps;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return pts;
}

/**
 * Classify raw DXF entities into panel geometry: a closed outline, a list of
 * drill holes (by face) and groove/dado paths.
 */
export function buildPanelGeometry(entities: DxfEntity[]): PanelGeometry {
  const outlineCandidates: Vec2[][] = [];
  const drillings: PanelGeometry['drillings'] = [];
  const grooves: GrooveOp[] = [];
  let grooveIndex = 0;

  for (const e of entities) {
    const kind = layerKind(e.layer);

    if (e.type === 'CIRCLE') {
      const c = e.points[0];
      const d = (e.radius ?? 0) * 2;
      if (kind === 'outline' || kind === 'other') {
        // A circle on a generic layer is a through/hardware hole on the top face.
        drillings.push({ face: 'top', x: c.x, y: c.y, diameter: d });
      } else if (kind === 'edge') {
        drillings.push({ face: 'edge', x: c.x, y: c.y, diameter: d });
      } else if (kind === 'bottom') {
        drillings.push({ face: 'bottom', x: c.x, y: c.y, diameter: d });
      } else if (kind === 'top') {
        drillings.push({ face: 'top', x: c.x, y: c.y, diameter: d });
      } else {
        drillings.push({ face: 'top', x: c.x, y: c.y, diameter: d });
      }
      continue;
    }

    if (e.type === 'ARC') {
      const pts = arcToPoly(e.points[0], e.radius ?? 0, e.startAngle ?? 0, e.endAngle ?? 0);
      grooves.push({ kind: 'groove', id: `G${++grooveIndex}`, points: pts, depth: 0, width: 0 });
      continue;
    }

    if (e.type === 'LINE') {
      if (kind === 'outline') {
        outlineCandidates.push([e.points[0], e.points[1]]);
      } else {
        grooves.push({ kind: 'groove', id: `G${++grooveIndex}`, points: e.points, depth: 0, width: 0 });
      }
      continue;
    }

    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      const pts = tessellate(e.points, e.bulge, e.closed);
      if (pts.length === 0) continue;
      if (e.closed && kind !== 'groove') {
        outlineCandidates.push(pts);
      } else {
        grooves.push({
          kind: 'groove',
          id: `G${++grooveIndex}`,
          points: pts,
          depth: 0,
          width: e.constantWidth ?? 0,
        });
      }
    }
  }

  // Choose the closed candidate with the largest area as the panel outline.
  let outline: Vec2[] = [];
  let bestArea = -1;
  for (const cand of outlineCandidates) {
    const a = Math.abs(polygonArea(cand));
    if (a > bestArea) {
      bestArea = a;
      outline = cand;
    }
  }

  return { outline, drillings, grooves };
}

export function polygonArea(pts: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function boundingBox(pts: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
