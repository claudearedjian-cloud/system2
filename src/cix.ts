/**
 * Native Biesse bSolid .cix compiler (Module B: Pod-and-Rail Optimizations).
 *
 * Emits clean ASCII-text part programs for the Biesse Rover A (Pod-and-Rail).
 *
 * Pod-and-Rail Specifics:
 * - Default geometric positioning on Stop 1 (Origin 1) field layout.
 * - Clean edge-referencing for horizontal boring aggregates (L/R/B/T).
 * - Spindle array mapping for vertical boring head (5mm, 8mm, 35mm hinge cups).
 * - Toolpath compensation for router grooves/dados.
 * - Alphanumeric filename synchronized with Cut Rite part code and barcode.
 */
import type { CixFile, DrillOp, GrooveOp, Panel, Project, Settings, ValidationReport } from '../shared/types.js';

const S = (n: number): string => {
  const v = Math.round(n * 100) / 100;
  return v >= 0 ? `+${v.toFixed(2)}` : `${v.toFixed(2)}`;
};

function padName(name: string, len = 32): string {
  const clean = name.replace(/[^A-Za-z0-9._-]/g, '_').toUpperCase();
  return clean.padEnd(len, ' ').slice(0, len).trimEnd();
}

function label(name: string, len = 3): string {
  return name.toUpperCase().padEnd(len, ' ');
}

export interface CixOptions {
  settings: Settings;
  prelude?: (panel: Panel, opts: { settings: Settings }) => string[];
  postlude?: () => string[];
}

export function panelFileName(panel: Panel): string {
  if (panel.cixFileName) return panel.cixFileName;
  const code = (panel.partCode || panel.id).replace(/[^A-Za-z0-9._-]/g, '_').toUpperCase();
  return `${code}.cix`;
}

export function compilePanel(panel: Panel, options: CixOptions): string {
  const { settings } = options;
  const lines: string[] = [];

  const prelude = options.prelude ?? defaultPrelude;
  lines.push(...prelude(panel, { settings }));

  // Pod-and-Rail workpiece setup (Origin 1 = Stop 1 Left-Bottom)
  const partName = panel.partCode || panel.id;
  lines.push(`${label('PAN')} ${padName(partName)}`);
  lines.push(`${label('DIM')} X${S(panel.width)} Y${S(panel.height)} T${S(panel.thickness)}`);
  lines.push(`${label('ORG')} 1 ; Pod-and-rail Stop 1 (Left-Bottom Reference)`);
  lines.push(`${label('ZSF')} +50.00 ; Safe Z Clearance Plane`);

  // Pod rail safety zone commentary
  const minPodY = Math.min(panel.height, 120);
  const maxPodY = Math.max(0, panel.height - 120);
  lines.push(`; POD CLEARANCE: Rails @ Y=${minPodY.toFixed(0)}mm & Y=${maxPodY.toFixed(0)}mm | Vacuum Pods=130x130mm`);

  // 1. Face drillings (Vertical Boring Head Spindle Array)
  const faceDrills = panel.drillings.filter((d) => d.face !== 'edge');
  if (faceDrills.length) {
    lines.push('');
    lines.push('; --- VERTICAL BORING UNIT (FACE DRILLING) ---');
    lines.push(`${label('FNC')} BOR  ON`);

    // Group drills by diameter to minimize spindle indexing
    const byDiameter = new Map<number, DrillOp[]>();
    for (const d of faceDrills) {
      const dia = d.diameter || 5;
      const list = byDiameter.get(dia) ?? [];
      list.push(d);
      byDiameter.set(dia, list);
    }

    for (const [dia, drills] of byDiameter) {
      const spindle = dia === 35 ? 3 : dia === 8 ? 2 : 1;
      const toolDesc = dia === 35 ? '35mm Hinge Cup' : dia === 8 ? '8mm Dowel Drill' : '5mm Shelf/System Drill';
      lines.push(`; Tool: Spindle ${spindle} (Ø${dia}mm - ${toolDesc})`);
      lines.push(`${label('SPD')} SP${spindle}`);

      for (const d of drills) {
        lines.push(`${label('LPX')} ${S(d.x)} ${label('LPY')} ${S(d.y)}`);
        lines.push(`${label('BOR')} D${S(d.diameter)} P${S(d.depth)}`);
      }
    }
    lines.push(`${label('FNC')} BOR  OFF`);
  }

  // 2. Edge drillings (Horizontal Boring Aggregate)
  const edgeDrills = panel.drillings.filter((d) => d.face === 'edge');
  if (edgeDrills.length) {
    lines.push('');
    lines.push('; --- HORIZONTAL BORING AGGREGATE (EDGE BORING) ---');
    lines.push(`${label('FNC')} AGG  ON`);

    // Group by edge (L, R, B, T)
    const byEdge = new Map<string, DrillOp[]>();
    for (const d of edgeDrills) {
      const edge = d.edge ?? 'L';
      const list = byEdge.get(edge) ?? [];
      list.push(d);
      byEdge.set(edge, list);
    }

    for (const [edge, drills] of byEdge) {
      const edgeName = edge === 'L' ? 'Left Edge (X=0)' : edge === 'R' ? 'Right Edge (X=Max)' : edge === 'B' ? 'Bottom Edge (Y=0)' : 'Top Edge (Y=Max)';
      lines.push(`; Edge Aggregate Face: ${edge} (${edgeName})`);
      for (const d of drills) {
        lines.push(`${label('LPX')} ${S(d.x)} ${label('LPY')} ${S(d.y)}`);
        lines.push(`${label('BOR')} D${S(d.diameter)} P${S(d.depth)} EDGE ${edge}`);
      }
    }
    lines.push(`${label('FNC')} AGG  OFF`);
  }

  // 3. Grooves / dados / routing toolpaths
  if (panel.grooves.length) {
    const routerTool = settings.tooling.tools.find((t) => t.type === 'router');
    const routerDia = routerTool?.diameter ?? settings.tooling.routerDiameter ?? 12;

    lines.push('');
    lines.push('; --- ROUTING SPINDLE (GROOVES / DADOS / PROFILING) ---');
    lines.push(`${label('FNC')} ROUT ON T=ROUTER_D${routerDia}`);

    for (let i = 0; i < panel.grooves.length; i++) {
      const g = panel.grooves[i];
      const first = g.points[0];
      const last = g.points[g.points.length - 1];
      if (!first || !last) continue;

      lines.push(`; Groove #${i + 1}: Width=${g.width || routerDia}mm, Depth=${g.depth}mm`);
      lines.push(`${label('LPX')} ${S(first.x)} ${label('LPY')} ${S(first.y)}`);
      lines.push(`${label('RAI')} X${S(last.x)} Y${S(last.y)} W${S(g.width || routerDia)} P${S(g.depth)}`);
    }
    lines.push(`${label('FNC')} ROUT OFF`);
  }

  const postlude = options.postlude ?? defaultPostlude;
  lines.push(...postlude());

  return lines.join('\n') + '\n';
}

export function compileProject(project: Project, settings: Settings, validation: ValidationReport): CixFile[] {
  if (!validation.ok) return [];
  const files: CixFile[] = [];
  for (const cabinet of project.cabinets) {
    for (const panel of cabinet.panels) {
      const content = compilePanel(panel, { settings });
      const name = panelFileName(panel);
      files.push({
        name,
        content,
        size: Buffer.byteLength(content, 'utf8'),
        panelId: panel.id,
        cabinetId: cabinet.id,
        partCode: panel.partCode || panel.id,
      });
    }
  }
  return files;
}

function defaultPrelude(panel: Panel, { settings }: { settings: Settings }): string[] {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const partCode = panel.partCode || panel.id;
  const barcode = panel.barcode || partCode;
  const lines = [
    ';======================================================',
    '; Biesse Rover A  -  bSolid Native Part Program (.cix)',
    '; Machine: Biesse Rover A Pod-and-Rail CNC',
    `; PART CODE : ${partCode}`,
    `; BARCODE   : ${barcode}`,
    `; DESC      : ${panel.name}  (${panel.panelType})`,
    `; CABINET   : ${panel.cabinetId}`,
    `; MATERIAL  : ${panel.material}  T=${panel.thickness}mm`,
    `; DIMENSIONS: ${panel.width} x ${panel.height} x ${panel.thickness} mm`,
    `; GRAIN     : ${panel.grain}`,
    `; DATE      : ${date}`,
    ';======================================================',
  ];
  return lines;
}

function defaultPostlude(): string[] {
  return [
    '',
    `${label('EPN')}`,
    ';======================================================',
    '; END OF BSOLID CIX PROGRAM',
    ';======================================================',
  ];
}
