/**
 * Cut Rite Optimization Pipeline (Module A).
 *
 * Formats raw structural dimensions, quantities, grain directions, edge-banding
 * and synchronized CNC program names into a standardized CSV import file
 * compatible with Holzma / Cut Rite optimization software.
 *
 * File Name Synchronization:
 * Enforces that Part Code == printed barcode value == bSolid .cix filename.
 */
import type { CutRiteReport, CutRiteRow, Edge, Panel, Project } from '../shared/types.js';
import { csvEscape } from './reports.js';

export function buildCutRiteReport(project: Project): CutRiteReport {
  const rows: CutRiteRow[] = [];
  let synchronizedCount = 0;

  for (const cabinet of project.cabinets) {
    for (const panel of cabinet.panels) {
      const partCode = panel.partCode || panel.id.replace(/[^A-Za-z0-9_-]/g, '_').toUpperCase();
      const cixProgram = panel.cixFileName || `${partCode}.cix`;
      const barcode = panel.barcode || partCode;

      // Check synchronization
      if (cixProgram === `${partCode}.cix` && (barcode === partCode || barcode === `P:${partCode}`)) {
        synchronizedCount++;
      }

      // Map grain: Cut Rite standard: 0 = none/any, 1 = length/horizontal, 2 = width/vertical
      let grainCode = 0;
      if (panel.grain === 'horizontal') grainCode = 1;
      else if (panel.grain === 'vertical') grainCode = 2;

      // Map edges to L1 (Top), L2 (Bottom), W1 (Left), W2 (Right)
      const getEdge = (e: Edge) => {
        const found = panel.edgeband?.find((b) => b.edge === e);
        return found ? `${found.material}` : '';
      };

      const row: CutRiteRow = {
        partCode,
        description: panel.name,
        material: panel.material,
        length: panel.width, // Finished length (X)
        width: panel.height, // Finished width (Y)
        thickness: panel.thickness,
        quantity: panel.qty,
        grain: grainCode,
        edgeL1: getEdge('T'), // Length 1 / Top
        edgeL2: getEdge('B'), // Length 2 / Bottom
        edgeW1: getEdge('L'), // Width 1 / Left
        edgeW2: getEdge('R'), // Width 2 / Right
        cncProgram: cixProgram,
        cabinet: cabinet.name,
        barcode,
      };

      rows.push(row);
    }
  }

  const totalParts = rows.length;
  const totalInstances = rows.reduce((s, r) => s + r.quantity, 0);
  const csv = cutRiteToCsv(rows);

  return {
    rows,
    totalParts,
    totalInstances,
    synchronizedCount,
    csv,
  };
}

export function cutRiteToCsv(rows: CutRiteRow[]): string {
  const header = [
    'Part Code',
    'Description',
    'Material',
    'Length (mm)',
    'Width (mm)',
    'Thickness (mm)',
    'Quantity',
    'Grain',
    'Edge L1 (Top)',
    'Edge L2 (Bottom)',
    'Edge W1 (Left)',
    'Edge W2 (Right)',
    'CNC Program',
    'Cabinet',
    'Barcode',
  ];

  const lines = rows.map((r) =>
    [
      r.partCode,
      r.description,
      r.material,
      r.length,
      r.width,
      r.thickness,
      r.quantity,
      r.grain,
      r.edgeL1,
      r.edgeL2,
      r.edgeW1,
      r.edgeW2,
      r.cncProgram,
      r.cabinet,
      r.barcode,
    ]
      .map((v) => csvEscape(String(v ?? '')))
      .join(','),
  );

  return [header.join(','), ...lines].join('\n');
}
