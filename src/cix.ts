/**
 * Native Biesse bSolid .cix compiler (Module C).
 *
 * The .cix file is Biesse's part program for the Rover A controlled through
 * bSolid.  A CIX file is a plain-text, line-oriented program whose blocks are
 * composed of an alphanumeric operation label followed by numeric coordinate
 * parameters, with numeric values that carry an explicit sign prefix.
 *
 * ⚠️  IMPORTANT — this generator is a clean, documented best-effort
 *     implementation of the CIX instruction-block structure.  Biesse's exact
 *     bSolid dialect is proprietary; ALWAYS verify the output on the real
 *     machine (and against your bSolid post-processor) before production.
 *     The `prelude`/`postlude` template strings below are the hook for
 *     machine-specific header blocks and can be edited without touching the
 *     geometry logic.
 *
 * Operation labels emitted here follow the common Biesse alphanumeric set:
 *   PAN  — panel / piece definition
 *   LPX  — linear positioning on X
 *   LPY  — linear positioning on Y
 *   LPZ  — linear positioning on Z
 *   XOR  — X origin shift
 *   YOR  — Y origin shift
 *   BOR  — boring / drilling operation
 *   ROU  — routing operation
 *   RAI  — routing / grooving operation
 *   FNC  — function (tool selection, spindle)
 *   DIM  — dimension declaration
 *   EPN  — end of panel
 *
 * The compiler is driven by a generic post-processor model so that the exact
 * block syntax can be swapped for a machine-verified template later.
 */
import type { CixFile, Panel, Project, Settings, ValidationReport } from '../shared/types.js';

const S = (n: number): string => {
  // Biesse-style signed numeric: values are written with an explicit sign.
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
  /** Header block for the machine (e.g. program number, material). */
  prelude?: (panel: Panel, opts: { settings: Settings }) => string[];
  /** Trailer block. */
  postlude?: () => string[];
}

export function panelFileName(panel: Panel): string {
  const id = panel.id.replace(/[^A-Za-z0-9._-]/g, '_').toUpperCase();
  return `${id}.cix`;
}

export function compilePanel(panel: Panel, options: CixOptions): string {
  const { settings } = options;
  const lines: string[] = [];

  const prelude = options.prelude ?? defaultPrelude;
  lines.push(...prelude(panel, { settings }));

  // Piece definition: dimensions + thickness.
  lines.push(`${label('PAN')} ${padName(panel.id)}`);
  lines.push(`${label('DIM')} X${S(panel.width)} Y${S(panel.height)} T${S(panel.thickness)}`);

  // Face drillings (boring block).
  if (panel.drillings.length) {
    const faceDrills = panel.drillings.filter((d) => d.face !== 'edge');
    if (faceDrills.length) {
      lines.push(`${label('FNC')} BOR  ON`); // activate boring unit
      for (const d of faceDrills) {
        lines.push(`${label('LPX')} ${S(d.x)}`);
        lines.push(`${label('LPY')} ${S(d.y)}`);
        lines.push(`${label('BOR')} D${S(d.diameter)} P${S(d.depth)}`);
      }
      lines.push(`${label('FNC')} BOR  OFF`);
    }
  }

  // Edge drillings (horizontal aggregate).
  const edgeDrills = panel.drillings.filter((d) => d.face === 'edge');
  if (edgeDrills.length) {
    lines.push(`${label('FNC')} AGG  ON`);
    for (const d of edgeDrills) {
      lines.push(`${label('LPX')} ${S(d.x)}`);
      lines.push(`${label('BOR')} D${S(d.diameter)} P${S(d.depth)} EDGE ${d.edge ?? 'L'}`);
    }
    lines.push(`${label('FNC')} AGG  OFF`);
  }

  // Grooves / dados / routing.
  if (panel.grooves.length) {
    const router = settings.tooling.tools.find((t) => t.type === 'router');
    lines.push(`${label('FNC')} ROUT ON`);
    for (const g of panel.grooves) {
      const first = g.points[0];
      const last = g.points[g.points.length - 1];
      if (!first || !last) continue;
      lines.push(`${label('LPX')} ${S(first.x)} ${label('LPY')} ${S(first.y)}`);
      lines.push(`${label('RAI')} X${S(last.x)} Y${S(last.y)} W${S(g.width || (router?.diameter ?? 12))} P${S(g.depth)}`);
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
      files.push({
        name: panelFileName(panel),
        content,
        size: Buffer.byteLength(content, 'utf8'),
      });
    }
  }
  return files;
}

function defaultPrelude(panel: Panel, { settings }: { settings: Settings }): string[] {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const lines = [
    ';------------------------------------------------------',
    '; Biesse Rover A  -  bSolid native part program (.cix)',
    `; PART  : ${panel.id}`,
    `; DESC  : ${panel.name}  (${panel.panelType})`,
    `; CAB   : ${panel.cabinetId}`,
    `; MAT   : ${panel.material}  T=${panel.thickness}mm`,
    `; SIZE  : ${panel.width} x ${panel.height} mm`,
    `; GRAIN : ${panel.grain}`,
    `; DATE  : ${date}`,
    ';------------------------------------------------------',
  ];
  return lines;
}

function defaultPostlude(): string[] {
  return [
    `${label('EPN')}`,
    '; end of program',
  ];
}
