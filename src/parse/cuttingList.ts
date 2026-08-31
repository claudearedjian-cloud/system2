/**
 * Polyboard-style cutting-list parser.
 *
 * Polyboard's text cutting list is a columnar text file; this parser is
 * deliberately tolerant of the common variations seen in the wild:
 *  - comma, tab or semicolon separated
 *  - a header row naming the columns (matched by substring, case-insensitive)
 *  - comment lines starting with "#" or "//"
 *
 * Recognised columns (partial names accepted):
 *   cabinet, part id / reference, panel / name, panel type, material,
 *   thickness, width / length, height / depth, qty, grain, and the four edge
 *   banding columns (edge L / R / B / T).
 */
import type { Edge, EdgebandSpec, Panel } from '../../shared/types.js';

export interface CuttingListRow {
  cabinetId: string;
  partId: string;
  name: string;
  panelType: string;
  material: string;
  thickness: number;
  width: number;
  height: number;
  qty: number;
  grain: Panel['grain'];
  edgeband: EdgebandSpec[];
  notes: string;
}

interface ColumnIndex {
  key: keyof CuttingListRow | `edge_${Edge}` | 'notes';
  idx: number;
}

const COLUMN_DEFS: { key: ColumnIndex['key']; match: string[] }[] = [
  { key: 'cabinetId', match: ['cabinet', 'unit', 'case'] },
  { key: 'partId', match: ['part id', 'partid', 'part', 'reference', 'ref', 'id'] },
  { key: 'name', match: ['name', 'panel name', 'piece'] },
  { key: 'panelType', match: ['panel type', 'type', 'description'] },
  { key: 'material', match: ['material', 'board', 'mat'] },
  { key: 'thickness', match: ['thickness', 'thick', 't(mm)'] },
  { key: 'width', match: ['width', 'length', 'x size', 'dimx', 'l(mm)'] },
  { key: 'height', match: ['height', 'depth', 'y size', 'dimy', 'w(mm)'] },
  { key: 'qty', match: ['qty', 'quantity', 'count', 'pieces'] },
  { key: 'grain', match: ['grain', 'direction', 'grain dir'] },
  { key: 'edge_L', match: ['edge l', 'edge left', 'left', 'band l', 'left edge'] },
  { key: 'edge_R', match: ['edge r', 'edge right', 'right', 'band r', 'right edge'] },
  { key: 'edge_B', match: ['edge b', 'edge bottom', 'bottom', 'band b', 'bottom edge'] },
  { key: 'edge_T', match: ['edge t', 'edge top', 'top', 'band t', 'top edge'] },
  { key: 'notes', match: ['notes', 'remark', 'comment'] },
];

const EDGES: Edge[] = ['L', 'R', 'B', 'T'];

function splitLine(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.includes('\t')) return trimmed.split('\t').map((s) => s.trim());
  if (trimmed.includes(';')) return trimmed.split(';').map((s) => s.trim());
  if (trimmed.includes(',')) return trimmed.split(',').map((s) => s.trim());
  return trimmed.split(/\s{2,}|\t/).map((s) => s.trim());
}

function resolveColumns(header: string[]): ColumnIndex[] {
  const cols: ColumnIndex[] = [];
  header.forEach((h, idx) => {
    const hl = h.toLowerCase().trim();
    if (!hl) return;
    // Score each column definition by the longest matching keyword so that
    // specific words ("width") beat generic substrings ("id", "mat", "t").
    let bestKey: ColumnIndex['key'] | null = null;
    let bestScore = 0;
    for (const def of COLUMN_DEFS) {
      for (const m of def.match) {
        if (hl.includes(m) && m.length > bestScore) {
          bestScore = m.length;
          bestKey = def.key;
        }
      }
    }
    if (bestKey && bestScore >= 2 && !cols.some((c) => c.key === bestKey)) {
      cols.push({ key: bestKey, idx });
    }
  });
  return cols;
}

function parseGrain(v: string): Panel['grain'] {
  const s = v.toLowerCase().trim();
  if (s.startsWith('v') || s.includes('along-height') || s === 'height') return 'vertical';
  if (s.startsWith('h') || s.includes('along-width') || s === 'width') return 'horizontal';
  if (s === 'none' || s === 'n' || s === '0' || s === '') return 'none';
  return 'horizontal';
}

function parseEdge(value: string): EdgebandSpec | null {
  const s = value.trim();
  if (s === '' || s === '0' || s.toLowerCase() === 'none' || s.toLowerCase() === 'no') return null;
  if (s === '1') return { edge: 'L', material: 'ABS 1mm', thickness: 1 }; // placeholder edge, fixed below
  // e.g. "ABS 1mm", "PVC 0.4mm", "1" -> derive material string
  const mm = /(\d+(?:\.\d+)?)\s*mm/.exec(s);
  const thickness = mm ? parseFloat(mm[1]) : 1;
  const base = s.replace(/[0-9.]+\s*mm/, '').trim();
  const material = (base || 'ABS').toUpperCase() + ` ${thickness}mm`;
  return { edge: 'L', material, thickness };
}

export function parseCuttingList(text: string): CuttingListRow[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith(';'));

  if (lines.length === 0) return [];

  // Header detection: a row containing "part" and "material"-ish words.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const low = lines[i].toLowerCase();
    if ((low.includes('part') || low.includes('reference') || low.includes('id')) && low.includes('material')) {
      headerIdx = i;
      break;
    }
  }

  const cols = headerIdx >= 0 ? resolveColumns(splitLine(lines[headerIdx])) : [];
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;

  const rows: CuttingListRow[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (cells.length === 0 || (cells.length === 1 && !cells[0])) continue;

    const get = (key: ColumnIndex['key']): string => {
      const col = cols.find((c) => c.key === key);
      return col ? (cells[col.idx] ?? '') : '';
    };

    const row: CuttingListRow = {
      cabinetId: get('cabinetId') || 'UNASSIGNED',
      partId: get('partId') || `P${i + 1}`,
      name: get('name') || get('partId') || `P${i + 1}`,
      panelType: get('panelType') || 'Panel',
      material: get('material') || 'Unknown',
      thickness: parseFloat(get('thickness')) || 0,
      width: parseFloat(get('width')) || 0,
      height: parseFloat(get('height')) || 0,
      qty: parseInt(get('qty'), 10) || 1,
      grain: parseGrain(get('grain')),
      edgeband: [],
      notes: get('notes'),
    };

    for (const e of EDGES) {
      const spec = parseEdge(get(`edge_${e}`));
      if (spec) row.edgeband.push({ ...spec, edge: e });
    }

    rows.push(row);
  }

  return rows;
}
