/**
 * Batch ingestion engine.
 *
 * Takes a set of imported files (cutting-list text, assembly/hardware CSVs,
 * per-part DXFs) and produces a normalized Project with cabinets, panels,
 * drillings, grooves, edge banding and 3D placements.
 */
import type {
  Cabinet,
  DrillFace,
  Panel,
  PanelPlacement,
  Project,
  Vec2,
} from '../../shared/types.js';
import { boundingBox, buildPanelGeometry, parseDxf } from './dxf.js';
import { parseAssemblyCsv, attachHardware } from './assembly.js';
import { parseCuttingList, type CuttingListRow } from './cuttingList.js';

export interface ImportFile {
  name: string; // file name (relative path if inside a folder)
  path: string; // absolute path on disk
  content: string; // decoded text
}

export interface ImportResult {
  project: Project;
  unmatched: string[]; // files that could not be attributed to any panel
  skipped: string[];
}

const DRILL_COLORS: Record<DrillFace, string> = {
  top: '#f5a623',
  bottom: '#7c4dff',
  edge: '#00bcd4',
};

export function sanitizePartCode(raw: string): string {
  // Convert to clean alphanumeric + hyphens + underscores (e.g. "JOB2026-CAB01-PART04")
  return raw
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function partIdFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const digits = base.match(/\d{2,4}/g);
  if (digits && digits.length) return digits[digits.length - 1];
  return base;
}

function cabinetIdFromFilename(name: string): string | null {
  const base = name.replace(/\.[^.]+$/, '');
  const m = base.match(/^([A-Za-z]+[-_]?\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

function synthesizeRect(width: number, height: number): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

export function importBatch(files: ImportFile[]): ImportResult {
  const textAndCsvFiles = files.filter((f) => /\.(txt|csv|tsv|tab|cut|list)$/i.test(f.name));
  const dxfFiles = files.filter((f) => /\.dxf$/i.test(f.name));

  // 1. Ingest Cutting lists & Hardware from any text/csv/tsv file
  const cuttingRows: CuttingListRow[] = [];
  const hardwareRows = [];

  for (const f of textAndCsvFiles) {
    const cutting = parseCuttingList(f.content);
    const hasValidPanels = cutting.length > 0 && cutting.some((r) => r.width > 0 || r.height > 0);

    if (hasValidPanels) {
      cuttingRows.push(...cutting);
    }

    // Check if it also contains hardware fittings
    const hw = parseAssemblyCsv(f.content);
    if (hw.length > 0 && (!hasValidPanels || hw.some((h) => h.kind && h.kind !== 'hardware' && h.kind !== 'Panel'))) {
      hardwareRows.push(...hw);
    }
  }

  // 3. DXF geometry keyed by part id
  const geometry = new Map<
    string,
    ReturnType<typeof buildPanelGeometry> & { cabinetHint: string | null; file: string }
  >();
  for (const f of dxfFiles) {
    let geo;
    try {
      geo = buildPanelGeometry(parseDxf(f.content).entities);
    } catch {
      continue;
    }
    const partId = partIdFromFilename(f.name);
    const key = partId.toLowerCase();
    geometry.set(key, { ...geo, cabinetHint: cabinetIdFromFilename(f.name), file: f.name });
  }

  // 4. Build panels from the cutting list (primary source of truth for
  // dimensions, material, edge banding and hardware).
  const panelsByCabinet = new Map<string, Panel[]>();
  const usedGeo = new Set<string>();

  for (const row of cuttingRows) {
    const cabinetId = row.cabinetId || 'UNASSIGNED';
    const rawId = `${cabinetId}-${row.partId}`;
    const partCode = sanitizePartCode(rawId);
    const geo = geometry.get(row.partId.toLowerCase());

    let outline = geo?.outline?.length ? geo.outline : synthesizeRect(row.width, row.height);
    if (geo) usedGeo.add(row.partId.toLowerCase());

    // Clamp outline to finished dimensions when geometry is missing or inconsistent
    const bb = boundingBox(outline);
    const bbW = bb.maxX - bb.minX;
    const bbH = bb.maxY - bb.minY;
    if (!geo || bbW < 1 || bbH < 1) {
      outline = synthesizeRect(row.width, row.height);
    } else if (row.width > 0 && (bbW > row.width * 1.6 || bbH > row.height * 1.6)) {
      const sx = row.width / bbW;
      const sy = row.height / bbH;
      outline = outline.map((p) => ({ x: p.x * sx, y: p.y * sy }));
    }

    const panel: Panel = {
      id: rawId,
      partCode,
      name: row.name,
      cabinetId,
      panelType: row.panelType,
      material: row.material,
      thickness: row.thickness,
      width: row.width,
      height: row.height,
      grain: row.grain,
      qty: row.qty,
      outline,
      drillings: (geo?.drillings ?? []).map((d, i) => ({
        kind: 'drill' as const,
        id: `${rawId}-D${i}`,
        face: d.face,
        edge: d.edge,
        x: d.x,
        y: d.y,
        diameter: d.diameter,
        depth: d.face === 'edge' ? 10 : Math.max(4, Math.min(d.diameter || 5, row.thickness * 0.5)),
        tool: d.face === 'edge' ? 'aggregate' : 'boring-block',
        spindle: d.diameter === 35 ? 3 : d.diameter === 8 ? 2 : 1,
        note: d.note,
      })),
      grooves: (geo?.grooves ?? []).map((g) => ({
        ...g,
        width: g.width > 0 ? g.width : 8,
        depth: g.depth > 0 ? g.depth : Math.min(8, Math.max(4, row.thickness * 0.45)),
      })),
      edgeband: row.edgeband,
      hardware: [],
      assemblyFlags: [],
      sourceFile: geo?.file ?? undefined,
      cixFileName: `${partCode}.cix`,
      barcode: partCode,
      status: 'pending_cut',
      history: [
        {
          timestamp: new Date().toISOString(),
          fromStatus: 'pending_cut',
          toStatus: 'pending_cut',
          station: 'manual',
          note: 'Imported from Polyboard export',
        },
      ],
    };

    const list = panelsByCabinet.get(cabinetId) ?? [];
    list.push(panel);
    panelsByCabinet.set(cabinetId, list);
  }

  // 5. DXF parts with no cutting-list entry: create panels from geometry.
  for (const [key, geo] of geometry) {
    if (usedGeo.has(key)) continue;
    const cabinetId = geo.cabinetHint ?? 'UNASSIGNED';
    const rawId = `${cabinetId}-${key.toUpperCase()}`;
    const partCode = sanitizePartCode(rawId);
    const bb = boundingBox(geo.outline.length ? geo.outline : synthesizeRect(100, 100));
    const panel: Panel = {
      id: rawId,
      partCode,
      name: key.toUpperCase(),
      cabinetId,
      panelType: 'Panel',
      material: 'Unknown',
      thickness: 18,
      width: Math.round(bb.maxX - bb.minX),
      height: Math.round(bb.maxY - bb.minY),
      grain: 'none',
      qty: 1,
      outline: geo.outline.length ? geo.outline : synthesizeRect(bb.maxX - bb.minX, bb.maxY - bb.minY),
      drillings: geo.drillings.map((d, i) => ({
        kind: 'drill' as const,
        id: `${rawId}-D${i}`,
        face: d.face,
        edge: d.edge,
        x: d.x,
        y: d.y,
        diameter: d.diameter,
        depth: d.face === 'edge' ? 10 : Math.max(4, Math.min(d.diameter || 5, 9)),
        tool: d.face === 'edge' ? 'aggregate' : 'boring-block',
        spindle: d.diameter === 35 ? 3 : d.diameter === 8 ? 2 : 1,
      })),
      grooves: (geo.grooves ?? []).map((g) => ({
        ...g,
        width: g.width > 0 ? g.width : 8,
        depth: g.depth > 0 ? g.depth : 8,
      })),
      edgeband: [],
      hardware: [],
      assemblyFlags: [],
      sourceFile: geo.file,
      cixFileName: `${partCode}.cix`,
      barcode: partCode,
      status: 'pending_cut',
      history: [
        {
          timestamp: new Date().toISOString(),
          fromStatus: 'pending_cut',
          toStatus: 'pending_cut',
          station: 'manual',
          note: 'Imported from DXF geometry',
        },
      ],
    };
    const list = panelsByCabinet.get(cabinetId) ?? [];
    list.push(panel);
    panelsByCabinet.set(cabinetId, list);
  }

  // 6. Attach hardware + assembly flags, then reconcile hardware depth and diameter
  attachHardware(hardwareRows, [...panelsByCabinet.values()].flat());
  mergeHardwareDepths([...panelsByCabinet.values()].flat());

  // 7. Cabinets + 3D placements.
  const cabinets: Cabinet[] = [];
  for (const [cabinetId, panels] of panelsByCabinet) {
    panels.sort((a, b) => a.panelType.localeCompare(b.panelType) || a.name.localeCompare(b.name));
    const { placements, width, height, depth } = placeCabinet(panels);
    cabinets.push({
      id: cabinetId,
      name: cabinetId === 'UNASSIGNED' ? 'Unassigned parts' : cabinetId,
      panels,
      placements,
      width,
      height,
      depth,
    });
  }
  cabinets.sort((a, b) => a.name.localeCompare(b.name));

  const allPanels = cabinets.flatMap((c) => c.panels);
  const materials = [...new Set(allPanels.map((p) => p.material))].filter((m) => m && m !== 'Unknown');
  const thicknesses = [...new Set(allPanels.map((p) => p.thickness))].sort((a, b) => a - b);

  const project: Project = {
    id: `project-${Date.now()}`,
    name: '',
    sourcePath: files[0]?.path.split('/').slice(0, -1).join('/') || undefined,
    importedAt: new Date().toISOString(),
    cabinets,
    stats: {
      cabinets: cabinets.length,
      panels: allPanels.length,
      partInstances: allPanels.reduce((s, p) => s + p.qty, 0),
      materials,
      thicknesses,
      statusSummary: {
        pendingCut: allPanels.reduce((s, p) => s + (p.status === 'pending_cut' ? p.qty : 0), 0),
        cutReady: allPanels.reduce((s, p) => s + (p.status === 'cut_ready' ? p.qty : 0), 0),
        machined: allPanels.reduce((s, p) => s + (p.status === 'machined' ? p.qty : 0), 0),
        staged: allPanels.reduce((s, p) => s + (p.status === 'staged' ? p.qty : 0), 0),
        assembled: allPanels.reduce((s, p) => s + (p.status === 'assembled' ? p.qty : 0), 0),
      },
    },
  };

  const unmatched = files
    .filter((f) => !/\.(txt|csv|dxf)$/i.test(f.name))
    .map((f) => f.name);

  return { project, unmatched, skipped: [] };
}

/** Apply exact fitting depth/diameter from the hardware table to matching drills. */
function mergeHardwareDepths(panels: Panel[]): void {
  for (const panel of panels) {
    for (const hw of panel.hardware) {
      if (hw.diameter === undefined && hw.depth === undefined) continue;
      let best: (typeof panel.drillings)[number] | undefined;
      let bestDist = 4.0;
      for (const d of panel.drillings) {
        if (d.face !== hw.face) continue;
        const dist = Math.hypot(d.x - hw.x, d.y - hw.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = d;
        }
      }
      if (best) {
        if (hw.diameter !== undefined) best.diameter = hw.diameter;
        if (hw.depth !== undefined) best.depth = hw.depth;
      }
    }
  }
}

function classify(panelType: string): 'side' | 'horizontal' | 'back' | 'front' {
  const t = panelType.toLowerCase();
  if (/side|end|gable|partition|divider|pilaster/.test(t)) return 'side';
  if (/back|rear/.test(t)) return 'back';
  if (/door|front|drawer|flap|face/.test(t)) return 'front';
  return 'horizontal';
}

function placeCabinet(panels: Panel[]): { placements: PanelPlacement[]; width: number; height: number; depth: number } {
  const sides = panels.filter((p) => classify(p.panelType) === 'side');
  const horizontals = panels.filter((p) => classify(p.panelType) === 'horizontal');
  const backs = panels.filter((p) => classify(p.panelType) === 'back');
  const fronts = panels.filter((p) => classify(p.panelType) === 'front');

  const width = Math.max(...horizontals.map((p) => p.width), ...sides.map((p) => p.width), 100);
  const height = Math.max(...sides.map((p) => p.height), ...backs.map((p) => p.height), 100);
  const depth = Math.max(...horizontals.map((p) => p.height), 100);

  const placements: PanelPlacement[] = [];
  let leftTaken = false;

  for (const p of sides) {
    const isLeft = !leftTaken;
    if (isLeft) leftTaken = true;
    const x = isLeft ? 0 : width - p.thickness;
    placements.push({
      panelId: p.id,
      origin: [x, 0, 0],
      uAxis: [0, 0, 1], // local X -> depth (Z)
      vAxis: [0, 1, 0], // local Y -> height (Y)
      thicknessAxis: [1, 0, 0], // thickness along X
      explodeVector: isLeft ? [-1.4, 0, 0] : [1.4, 0, 0],
    });
  }

  const topBottoms = horizontals.filter((p) => /top|roof|deck|cover/.test(p.panelType.toLowerCase()));
  const bottoms = topBottoms.filter((p) => /bottom|base|deck|floor/.test(p.panelType.toLowerCase()));
  const tops = topBottoms.filter((p) => !bottoms.includes(p));
  const shelves = horizontals.filter((p) => !topBottoms.includes(p));

  const placeHorizontal = (p: Panel, y: number, explodeY: number) => {
    placements.push({
      panelId: p.id,
      origin: [0, y, 0],
      uAxis: [1, 0, 0], // width along X
      vAxis: [0, 0, 1], // height along Z (depth)
      thicknessAxis: [0, 1, 0], // thickness along Y
      explodeVector: [0, explodeY, 0],
    });
  };

  bottoms.forEach((p) => placeHorizontal(p, 0, -1.2));
  tops.forEach((p) => placeHorizontal(p, height - p.thickness, 1.2));

  if (shelves.length > 0) {
    const usable = height - (tops.length ? tops[0].thickness : 18) - (bottoms.length ? bottoms[0].thickness : 18);
    const step = usable / (shelves.length + 1);
    const base = bottoms.length ? bottoms[0].thickness : 18;
    shelves.forEach((p, i) => {
      const y = base + step * (i + 1);
      placeHorizontal(p, y, (i - (shelves.length - 1) / 2) * 0.5);
    });
  }

  for (const p of backs) {
    placements.push({
      panelId: p.id,
      origin: [0, 0, 0],
      uAxis: [1, 0, 0], // width along X
      vAxis: [0, 1, 0], // height along Y
      thicknessAxis: [0, 0, 1], // thickness along Z
      explodeVector: [0, 0, -1.4],
    });
  }

  for (const p of fronts) {
    placements.push({
      panelId: p.id,
      origin: [0, 0, depth],
      uAxis: [1, 0, 0],
      vAxis: [0, 1, 0],
      thicknessAxis: [0, 0, 1],
      explodeVector: [0, 0, 1.4],
    });
  }

  return { placements, width, height, depth };
}

export { DRILL_COLORS };
