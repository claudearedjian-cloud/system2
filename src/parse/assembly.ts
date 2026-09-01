/**
 * Assembly / hardware CSV parser.
 *
 * Polyboard can export an assembly list (CSV) describing, for each part, the
 * structural joins and hardware: blind dados, hinges, drawer slides, shelf
 * pins and connectors, with their panel-local coordinates.
 *
 * This parser reads both a generic "assembly.csv" schema and a
 * "hardware.csv" schema.  Rows are keyed by part ID and merged into the
 * panels as hardware items and assembly flags.
 */
import type { DrillFace, HardwareItem } from '../../shared/types.js';

export interface HardwareRow {
  partId: string;
  kind: string;
  face: DrillFace;
  x: number;
  y: number;
  z: number;
  diameter?: number;
  depth?: number;
  note?: string;
  assemblyFlag?: string;
}

function splitLine(line: string): string[] {
  const t = line.trim();
  if (t.includes(';')) return t.split(';').map((s) => s.trim());
  if (t.includes('\t')) return t.split('\t').map((s) => s.trim());
  return t.split(',').map((s) => s.trim());
}

function headerIndex(header: string[], names: string[]): number {
  return header.findIndex((h) => {
    const hl = h.toLowerCase().trim();
    return names.some((n) => hl === n || hl.includes(n));
  });
}

function parseFace(s: string): DrillFace {
  const v = s.toLowerCase().trim();
  if (v.includes('edge') || v.includes('edge')) return 'edge';
  if (v.includes('bottom') || v.includes('bas')) return 'bottom';
  return 'top';
}

export function parseAssemblyCsv(text: string): HardwareRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = splitLine(lines[0]);

  const partIdx = headerIndex(header, ['part', 'part id', 'partid', 'reference', 'panel']);
  if (partIdx < 0) return [];

  const kindIdx = headerIndex(header, ['hardware', 'kind', 'item', 'type', 'fitting']);
  const faceIdx = headerIndex(header, ['face', 'side', 'surface']);
  const xIdx = headerIndex(header, ['x', 'x mm', 'xmm', 'posx', 'x pos']);
  const yIdx = headerIndex(header, ['y', 'y mm', 'ymm', 'posy', 'y pos']);
  const zIdx = headerIndex(header, ['z', 'z mm', 'zmm', 'posz', 'z pos']);
  const diaIdx = headerIndex(header, ['diameter', 'dia', 'd mm']);
  const depthIdx = headerIndex(header, ['depth', 'deep']);
  const noteIdx = headerIndex(header, ['note', 'notes', 'remark']);
  const flagIdx = headerIndex(header, ['flag', 'assembly', 'join']);

  const rows: HardwareRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (cells.length <= partIdx) continue;
    const row: HardwareRow = {
      partId: cells[partIdx]?.trim() || '',
      kind: (kindIdx >= 0 ? cells[kindIdx] : 'hardware').trim() || 'hardware',
      face: faceIdx >= 0 ? parseFace(cells[faceIdx]) : 'top',
      x: xIdx >= 0 ? parseFloat(cells[xIdx]) || 0 : 0,
      y: yIdx >= 0 ? parseFloat(cells[yIdx]) || 0 : 0,
      z: zIdx >= 0 ? parseFloat(cells[zIdx]) || 0 : 0,
      diameter: diaIdx >= 0 ? parseFloat(cells[diaIdx]) || undefined : undefined,
      depth: depthIdx >= 0 ? parseFloat(cells[depthIdx]) || undefined : undefined,
      note: noteIdx >= 0 ? cells[noteIdx] : undefined,
      assemblyFlag: flagIdx >= 0 ? cells[flagIdx] || undefined : undefined,
    };
    if (row.partId) rows.push(row);
  }
  return rows;
}

/** Merge hardware rows into panels as HardwareItem entries + assembly flags. */
export function attachHardware(
  rows: HardwareRow[],
  panels: { id: string; hardware: HardwareItem[]; assemblyFlags: string[] }[],
): void {
  for (const row of rows) {
    const panel = panels.find((p) => {
      const segment = p.id.split('-').pop()?.toLowerCase() ?? p.id.toLowerCase();
      return p.id.toLowerCase() === row.partId.toLowerCase() || segment === row.partId.toLowerCase();
    });
    if (!panel) continue;
    panel.hardware.push({
      id: `${row.partId}-${panel.hardware.length + 1}`,
      kind: row.kind,
      face: row.face,
      x: row.x,
      y: row.y,
      z: row.z,
      diameter: row.diameter,
      depth: row.depth,
      note: row.note,
    });
    if (row.assemblyFlag && !panel.assemblyFlags.includes(row.assemblyFlag)) {
      panel.assemblyFlags.push(row.assemblyFlag);
    }
    if (row.kind.toLowerCase().includes('dado') || row.kind.toLowerCase().includes('blind')) {
      if (!panel.assemblyFlags.includes('blind-dado')) panel.assemblyFlags.push('blind-dado');
    }
  }
}
