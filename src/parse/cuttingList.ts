/**
 * Polyboard-style cutting-list parser (Multi-Format & International CSV/TXT/TSV).
 *
 * Highly tolerant parser for cutting lists across all versions of Polyboard,
 * OptiCut, Cut Rite, and general CAM exports:
 *  - comma, tab, semicolon, or pipe separated
 *  - quoted CSV values (handles commas inside descriptions/materials)
 *  - multi-lingual header recognition (EN, FR, DE, ES, IT)
 *  - intelligent column scoring and fallback dimension deduction
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

type DefKey =
  | 'cabinetId'
  | 'partId'
  | 'name'
  | 'panelType'
  | 'material'
  | 'thickness'
  | 'length_col'
  | 'width_col'
  | 'height_col'
  | 'qty'
  | 'grain'
  | 'edge_T'
  | 'edge_B'
  | 'edge_L'
  | 'edge_R'
  | 'notes';

interface ColumnIndex {
  key: DefKey;
  idx: number;
}

const COLUMN_DEFS: { key: DefKey; match: string[] }[] = [
  {
    key: 'cabinetId',
    match: ['cabinet', 'unit', 'case', 'box', 'meuble', 'caisson', 'schrank', 'korpus', 'mobile', 'assembly', 'subassembly', 'cab'],
  },
  {
    key: 'partId',
    match: ['part id', 'partid', 'part_id', 'part no', 'part #', 'part', 'reference', 'ref', 'code', 'pos', 'position', 'mark', 'repere', 'repère', 'piece no', 'piece id', 'id'],
  },
  {
    key: 'name',
    match: ['panel name', 'part name', 'piece name', 'name', 'panel', 'piece', 'description', 'designation', 'désignation', 'bezeichnung', 'nome', 'desc'],
  },
  {
    key: 'panelType',
    match: ['panel type', 'part type', 'type', 'category', 'role', 'function', 'fonction'],
  },
  {
    key: 'material',
    match: ['material', 'board', 'mat', 'matiere', 'matière', 'matériau', 'werkstoff', 'materiale', 'panel material', 'core', 'wood'],
  },
  {
    key: 'thickness',
    match: ['thickness', 'thick', 'thk', 't(mm)', 't (mm)', 'epaisseur', 'épaisseur', 'epais', 'stärke', 'dicke', 'staerke', 'espesor', 'spessore', 'dimz', 'dim_z', 'dim z', 'z size', 'z'],
  },
  {
    key: 'length_col',
    match: ['length', 'cut length', 'finished length', 'gross length', 'net length', 'longueur', 'länge', 'laenge', 'longitud', 'lunghezza', 'dimx', 'dim_x', 'l(mm)', 'l (mm)', 'x size', 'x', 'dim x'],
  },
  {
    key: 'width_col',
    match: ['width', 'cut width', 'finished width', 'gross width', 'net width', 'largeur', 'breite', 'ancho', 'larghezza', 'dimy', 'dim_y', 'w(mm)', 'w (mm)', 'y size', 'y', 'dim y'],
  },
  {
    key: 'height_col',
    match: ['height', 'cut height', 'finished height', 'depth', 'hauteur', 'profondeur', 'tiefe', 'hoehe', 'höhe', 'alto', 'profundidad', 'altezza', 'profondita', 'h(mm)', 'h (mm)', 'd(mm)', 'd (mm)'],
  },
  {
    key: 'qty',
    match: ['quantity', 'qty', 'count', 'pieces', 'pcs', 'quantite', 'quantité', 'qte', 'qté', 'stück', 'stueck', 'anzahl', 'quantita', 'cantidad', 'nb', 'q'],
  },
  {
    key: 'grain',
    match: ['grain', 'direction', 'grain dir', 'sens fil', 'maserung', 'venatura', 'fibra'],
  },
  {
    key: 'edge_T',
    match: ['edge t', 'edge top', 'top edge', 'edge_t', 'chant haut', 'chant h', 'kante oben', 'kante o', 'edge l1', 'l1', 'top'],
  },
  {
    key: 'edge_B',
    match: ['edge b', 'edge bottom', 'bottom edge', 'edge_b', 'chant bas', 'chant b', 'kante unten', 'kante u', 'edge l2', 'l2', 'bottom'],
  },
  {
    key: 'edge_L',
    match: ['edge l', 'edge left', 'left edge', 'edge_l', 'chant gauche', 'chant g', 'kante links', 'kante l', 'edge w1', 'w1', 'left'],
  },
  {
    key: 'edge_R',
    match: ['edge r', 'edge right', 'right edge', 'edge_r', 'chant droit', 'chant d', 'kante rechts', 'kante r', 'edge w2', 'w2', 'right'],
  },
  {
    key: 'notes',
    match: ['notes', 'note', 'remark', 'comment', 'remarque', 'bemerkung', 'osservazioni'],
  },
];

const EDGES: Edge[] = ['L', 'R', 'B', 'T'];

/** Robust CSV splitter handling quotes, semicolons, tabs, commas, and pipes */
function splitCsvLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Determine delimiter: tab, semicolon, pipe, or comma
  let delimiter = ',';
  if (trimmed.includes('\t')) delimiter = '\t';
  else if (trimmed.includes(';') && !trimmed.includes('\t')) delimiter = ';';
  else if (trimmed.includes('|')) delimiter = '|';

  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '"' || char === "'") {
      insideQuotes = !insideQuotes;
    } else if (char === delimiter && !insideQuotes) {
      cells.push(cleanCell(current));
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(cleanCell(current));
  return cells;
}

function cleanCell(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '').trim();
}

/** Resolves header columns using fuzzy keyword matching and score ranking */
function resolveColumns(header: string[]): ColumnIndex[] {
  const cols: ColumnIndex[] = [];
  header.forEach((h, idx) => {
    const hl = h.toLowerCase().trim().replace(/[_./\\-]/g, ' ');
    if (!hl) return;

    let bestKey: DefKey | null = null;
    let bestScore = 0;

    for (const def of COLUMN_DEFS) {
      for (const m of def.match) {
        if (hl === m) {
          // Exact match gets highest priority
          if (m.length + 100 > bestScore) {
            bestScore = m.length + 100;
            bestKey = def.key;
          }
        } else if (hl.includes(m) || m.includes(hl)) {
          if (m.length > bestScore) {
            bestScore = m.length;
            bestKey = def.key;
          }
        }
      }
    }

    if (bestKey && bestScore >= 1 && !cols.some((c) => c.key === bestKey)) {
      cols.push({ key: bestKey, idx });
    }
  });

  return cols;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  // Replace comma decimal separators (e.g. "18,5" -> "18.5")
  const sanitized = String(value).replace(',', '.').replace(/[^0-9.-]/g, '');
  const num = parseFloat(sanitized);
  return Number.isFinite(num) ? num : 0;
}

function parseGrain(v: string): Panel['grain'] {
  const s = v.toLowerCase().trim();
  if (s.startsWith('v') || s.includes('along-height') || s === 'height' || s === '1' || s === 'long') return 'vertical';
  if (s.startsWith('h') || s.includes('along-width') || s === 'width' || s === '2' || s === 'larg') return 'horizontal';
  if (s === 'none' || s === 'n' || s === '0' || s === '') return 'none';
  return 'horizontal';
}

function parseEdge(value: string): EdgebandSpec | null {
  const s = value.trim();
  if (s === '' || s === '0' || s.toLowerCase() === 'none' || s.toLowerCase() === 'no' || s === '—' || s === '-') return null;
  if (s === '1') return { edge: 'L', material: 'ABS 1mm', thickness: 1 };
  const mm = /(\d+(?:\.\d+)?)\s*mm/i.exec(s);
  const thickness = mm ? parseFloat(mm[1]) : 1;
  const base = s.replace(/[0-9.]+\s*mm/gi, '').trim();
  const material = (base || 'ABS').toUpperCase() + ` ${thickness}mm`;
  return { edge: 'L', material, thickness };
}

export function parseCuttingList(text: string): CuttingListRow[] {
  if (!text || !text.trim()) return [];

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

  if (lines.length === 0) return [];

  // Find header row: inspect first 12 rows and score based on cutting list terminology
  let bestHeaderIdx = -1;
  let bestColCount = 0;
  let bestCols: ColumnIndex[] = [];

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const rawCells = splitCsvLine(lines[i]);
    if (rawCells.length < 2) continue;
    const cols = resolveColumns(rawCells);
    const hasDimensions = cols.some((c) => c.key === 'length_col' || c.key === 'width_col' || c.key === 'height_col' || c.key === 'thickness');
    const hasPartId = cols.some((c) => c.key === 'partId' || c.key === 'name' || c.key === 'cabinetId');

    if ((hasDimensions || hasPartId) && cols.length > bestColCount) {
      bestColCount = cols.length;
      bestHeaderIdx = i;
      bestCols = cols;
    }
  }

  const dataStart = bestHeaderIdx >= 0 ? bestHeaderIdx + 1 : 0;
  const cols = bestCols;

  const lenCol = cols.find((c) => c.key === 'length_col');
  const widCol = cols.find((c) => c.key === 'width_col');
  const hgtCol = cols.find((c) => c.key === 'height_col');
  const thkCol = cols.find((c) => c.key === 'thickness');

  const rows: CuttingListRow[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 2 || (cells.length === 1 && !cells[0])) continue;

    const get = (key: DefKey): string => {
      const col = cols.find((c) => c.key === key);
      return col && cells[col.idx] !== undefined ? cells[col.idx] : '';
    };

    let cabVal = get('cabinetId');
    let partIdVal = get('partId');
    let nameVal = get('name');
    let matVal = get('material');
    let thickVal = thkCol ? parseNumber(cells[thkCol.idx]) : parseNumber(get('thickness'));
    let qtyVal = Math.max(1, parseInt(get('qty'), 10) || 1);

    // Derive dimensions (Length / Width / Height)
    let widthVal = 0;
    let heightVal = 0;

    if (lenCol && widCol && lenCol.idx !== widCol.idx) {
      widthVal = parseNumber(cells[lenCol.idx]);
      heightVal = parseNumber(cells[widIdxOrOther(cells, widCol.idx)]);
    } else if (widCol && hgtCol && widCol.idx !== hgtCol.idx) {
      widthVal = parseNumber(cells[widCol.idx]);
      heightVal = parseNumber(cells[hgtCol.idx]);
    } else if (lenCol && hgtCol && lenCol.idx !== hgtCol.idx) {
      widthVal = parseNumber(cells[lenCol.idx]);
      heightVal = parseNumber(cells[hgtCol.idx]);
    } else if (lenCol) {
      widthVal = parseNumber(cells[lenCol.idx]);
      heightVal = hgtCol ? parseNumber(cells[hgtCol.idx]) : 0;
    } else if (widCol) {
      widthVal = parseNumber(cells[widCol.idx]);
      heightVal = hgtCol ? parseNumber(cells[hgtCol.idx]) : 0;
    }

    // Fallback numeric recovery if header didn't catch both dimensions
    if (widthVal === 0 || heightVal === 0) {
      const numbers = cells.map(parseNumber).filter((n) => n > 0);
      const large = numbers.filter((n) => n >= 50);
      const small = numbers.filter((n) => n > 0 && n < 50);

      if (large.length >= 2) {
        if (widthVal === 0) widthVal = large[0];
        if (heightVal === 0) heightVal = large[1];
      } else if (large.length === 1 && numbers.length >= 2) {
        if (widthVal === 0) widthVal = large[0];
        if (heightVal === 0) heightVal = numbers.find((n) => n !== large[0]) || 0;
      }
      if (small.length >= 1 && thickVal === 0) {
        thickVal = small[0];
      }
    }

    if (!partIdVal) partIdVal = `P${rows.length + 1}`;
    if (!nameVal) nameVal = partIdVal;
    if (!cabVal) cabVal = 'CAB-01';
    if (!matVal) matVal = 'Melamine 18mm';
    if (thickVal === 0) thickVal = 18;

    const row: CuttingListRow = {
      cabinetId: cabVal,
      partId: partIdVal,
      name: nameVal,
      panelType: get('panelType') || guessPanelType(nameVal),
      material: matVal,
      thickness: thickVal,
      width: widthVal,
      height: heightVal,
      qty: qtyVal,
      grain: parseGrain(get('grain')),
      edgeband: [],
      notes: get('notes'),
    };

    const edgeT = parseEdge(get('edge_T'));
    if (edgeT) row.edgeband.push({ ...edgeT, edge: 'T' });
    const edgeB = parseEdge(get('edge_B'));
    if (edgeB) row.edgeband.push({ ...edgeB, edge: 'B' });
    const edgeL = parseEdge(get('edge_L'));
    if (edgeL) row.edgeband.push({ ...edgeL, edge: 'L' });
    const edgeR = parseEdge(get('edge_R'));
    if (edgeR) row.edgeband.push({ ...edgeR, edge: 'R' });

    if (row.width > 0 || row.height > 0 || row.partId) {
      rows.push(row);
    }
  }

  return rows;
}

function widIdxOrOther(cells: string[], idx: number): number {
  return idx < cells.length ? idx : 0;
}

function guessPanelType(name: string): string {
  const n = name.toLowerCase();
  if (/side|cote|côté|seite|end|gable|flanco/.test(n)) return 'Side';
  if (/top|haut|oberboden|cover|roof|deck/.test(n)) return 'Top';
  if (/bottom|bas|unterboden|floor|base|deckel/.test(n)) return 'Bottom';
  if (/shelf|etagere|étagère|fachboden|regalboden/.test(n)) return 'Shelf';
  if (/back|fond|rückwand|rueckwand|trasera/.test(n)) return 'Back';
  if (/door|porte|tür|tuer|drawer|front|tiroir/.test(n)) return 'Door';
  return 'Panel';
}
