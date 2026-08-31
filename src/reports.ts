/**
 * Shop-floor documentation: bills of materials, cost summaries and printable
 * barcode-ready part labels (Module D).
 */
import type { BomLine, BomMaterialSummary, BomReport, LabelData, Project, Settings } from '../shared/types.js';

export function buildBom(project: Project, settings: Settings): BomReport {
  const lines: BomLine[] = [];
  const materials = new Map<string, BomMaterialSummary>();

  for (const cabinet of project.cabinets) {
    for (const panel of cabinet.panels) {
      const areaM2 = (panel.width * panel.height) / 1e6;
      const edgeband = panel.edgeband
        .map((e) => `${e.edge}:${e.material}`)
        .join(', ');
      const secondaryOps = panel.assemblyFlags.slice();
      const hardware = panel.hardware.map((h) => h.kind);

      lines.push({
        partId: panel.id,
        name: panel.name,
        cabinet: cabinet.name,
        material: panel.material,
        thickness: panel.thickness,
        width: panel.width,
        height: panel.height,
        qty: panel.qty,
        areaM2: round2(areaM2 * panel.qty),
        edgeband,
        secondaryOps,
        hardware,
      });

      const key = `${panel.material}|${panel.thickness}`;
      const s = materials.get(key);
      if (s) {
        s.partCount += 1;
        s.instanceCount += panel.qty;
        s.areaM2 += areaM2 * panel.qty;
      } else {
        const [bw, bh] = settings.costs.boardSize;
        materials.set(key, {
          material: panel.material,
          thickness: panel.thickness,
          partCount: 1,
          instanceCount: panel.qty,
          areaM2: areaM2 * panel.qty,
          boardSize: [bw, bh],
          wastePercent: settings.costs.wastePercent,
          estimatedBoards: 0,
          cost: 0,
        });
      }
    }
  }

  let totalCost = 0;
  let edgebandMeters = 0;
  for (const summary of materials.values()) {
    const [bw, bh] = summary.boardSize;
    const boardArea = (bw * bh) / 1e6;
    const usable = summary.areaM2 / (1 - summary.wastePercent / 100);
    summary.estimatedBoards = Math.max(1, Math.ceil(usable / boardArea));
    const pricePerM2 = settings.costs.costPerSqm[summary.material] ?? 35;
    summary.cost = round2(summary.estimatedBoards * boardArea * pricePerM2);
    totalCost += summary.cost;
  }

  // Edge banding linear metres: sum banded edge lengths across the batch.
  for (const cabinet of project.cabinets) {
    for (const panel of cabinet.panels) {
      for (const e of panel.edgeband) {
        const length = e.edge === 'T' || e.edge === 'B' ? panel.width : panel.height;
        edgebandMeters += (length / 1000) * panel.qty;
      }
    }
  }
  edgebandMeters = round2(edgebandMeters);
  totalCost += edgebandMeters * settings.costs.edgebandPerMeter;
  totalCost = round2(totalCost);

  return {
    lines,
    materials: [...materials.values()],
    edgebandMeters,
    totalCost,
    currency: settings.costs.currency,
  };
}

export function buildLabels(project: Project, bom: BomReport): LabelData[] {
  const labels: LabelData[] = [];
  const byId = new Map(bom.lines.map((l) => [l.partId, l]));
  for (const cabinet of project.cabinets) {
    for (const panel of cabinet.panels) {
      const line = byId.get(panel.id);
      labels.push({
        partId: panel.id,
        project: project.name || 'Unnamed project',
        cabinet: cabinet.name,
        name: panel.name,
        material: panel.material,
        thickness: panel.thickness,
        width: panel.width,
        height: panel.height,
        edgeband: line?.edgeband ?? '',
        secondaryOps: line?.secondaryOps ?? [],
        qty: panel.qty,
        barcode: barcodePayload(panel.id),
      });
    }
  }
  return labels;
}

/** Code-128 payload for the part label: ID, project, material, edge info. */
function barcodePayload(partId: string): string {
  return `P:${partId}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bomToCsv(bom: BomReport): string {
  const header = ['Part ID', 'Name', 'Cabinet', 'Material', 'Thickness', 'Width', 'Height', 'Qty', 'Area m2', 'Edgeband', 'Secondary ops', 'Hardware'];
  const rows = bom.lines.map((l) =>
    [l.partId, l.name, l.cabinet, l.material, l.thickness, l.width, l.height, l.qty, l.areaM2, l.edgeband, l.secondaryOps.join(';'), l.hardware.join(';')]
      .map((v) => csvEscape(String(v)))
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}
