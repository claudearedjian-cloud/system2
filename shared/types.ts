/**
 * Shared data model for the Polyboard batch-to-bSolid pipeline.
 * These types are the single source of truth between the parsers,
 * the validation engine, the CIX compiler, and the web frontend.
 *
 * All lengths are in millimetres.  Panel-local 2D coordinates use
 * X = panel length (0..width), Y = panel height (0..height), origin at the
 * bottom-left corner.  This matches the 2D viewer and the DXF plane.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type Edge = 'L' | 'R' | 'B' | 'T'; // Left, Right, Bottom, Top

export interface EdgebandSpec {
  edge: Edge;
  material: string; // e.g. "ABS 1mm", "PVC 0.4mm"
  thickness: number; // mm
}

export type DrillFace = 'top' | 'bottom' | 'edge';

export interface DrillOp {
  kind: 'drill';
  id: string;
  face: DrillFace;
  /** For edge drillings, which edge the hole is bored into. */
  edge?: Edge;
  /** Local 2D position (mm). For edge drillings, X runs along the edge. */
  x: number;
  y: number;
  diameter: number;
  depth: number;
  tool?: string;
  note?: string;
}

export interface GrooveOp {
  kind: 'groove';
  id: string;
  points: Vec2[];
  depth: number;
  width: number;
  note?: string;
}

export interface HardwareItem {
  id: string;
  kind: string; // hinge, drawer slide, shelf pin, connector...
  face: DrillFace;
  x: number;
  y: number;
  z: number;
  diameter?: number;
  depth?: number;
  note?: string;
}

export interface Panel {
  id: string;
  name: string;
  cabinetId: string;
  panelType: string; // Left Side, Shelf, Door, ...
  material: string; // e.g. "18mm Melamine White"
  thickness: number;
  width: number; // finished length (mm)
  height: number; // finished width (mm)
  /** Wood grain direction: vertical = along panel height, horizontal = along width. */
  grain: 'vertical' | 'horizontal' | 'none';
  qty: number;
  outline: Vec2[]; // closed polygon, panel-local coords
  drillings: DrillOp[];
  grooves: GrooveOp[];
  edgeband: EdgebandSpec[];
  hardware: HardwareItem[];
  assemblyFlags: string[];
  sourceFile?: string;
}

/** Maps a panel's local 2D frame into cabinet world space for the 3D preview. */
export interface PanelPlacement {
  panelId: string;
  origin: [number, number, number];
  uAxis: [number, number, number]; // local X -> world
  vAxis: [number, number, number]; // local Y -> world
  thicknessAxis: [number, number, number]; // local Z (thickness) -> world
}

export interface Cabinet {
  id: string;
  name: string;
  panels: Panel[];
  placements: PanelPlacement[];
}

export interface ProjectStats {
  cabinets: number;
  panels: number;
  partInstances: number;
  materials: string[];
  thicknesses: number[];
}

export interface Project {
  id: string;
  name: string;
  sourcePath?: string;
  importedAt: string;
  cabinets: Cabinet[];
  stats: ProjectStats;
}

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  panelId: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

export interface CixFile {
  name: string;
  content: string;
  size: number;
}

export interface CompileResult {
  ok: boolean;
  blocked: boolean; // true when validation errors prevented code generation
  validation: ValidationReport;
  files: CixFile[];
  outputDir: string;
}

export interface BomLine {
  partId: string;
  name: string;
  cabinet: string;
  material: string;
  thickness: number;
  width: number;
  height: number;
  qty: number;
  areaM2: number;
  edgeband: string; // human summary e.g. "L,R,T,B ABS 1mm"
  secondaryOps: string[];
  hardware: string[];
}

export interface BomMaterialSummary {
  material: string;
  thickness: number;
  partCount: number;
  instanceCount: number;
  areaM2: number;
  boardSize: [number, number];
  wastePercent: number;
  estimatedBoards: number;
  cost: number;
}

export interface BomReport {
  lines: BomLine[];
  materials: BomMaterialSummary[];
  edgebandMeters: number;
  totalCost: number;
  currency: string;
}

export interface LabelData {
  partId: string;
  project: string;
  cabinet: string;
  name: string;
  material: string;
  thickness: number;
  width: number;
  height: number;
  edgeband: string;
  secondaryOps: string[];
  qty: number;
  barcode: string; // Code-128 payload
}

export interface MachineTool {
  id: string;
  name: string;
  type: 'router' | 'drill' | 'boring-block' | 'aggregate';
  diameter: number;
  spindle?: number;
}

export interface ToolingConfig {
  routerDiameter: number;
  tools: MachineTool[];
}

export interface NetworkConfig {
  enabled: boolean;
  protocol: 'local' | 'smb';
  /** Local directory (or mounted SMB share path) to receive compiled .cix files. */
  targetDir: string;
  /** Optional sub-folder per machine, e.g. "rover-a" and "nesting-station". */
  machineFolders: { name: string; folder: string }[];
}

export interface CostConfig {
  currency: string;
  boardSize: [number, number];
  wastePercent: number;
  costPerSqm: Record<string, number>; // material name -> price per m2
  edgebandPerMeter: number;
}

export interface Settings {
  tooling: ToolingConfig;
  network: NetworkConfig;
  costs: CostConfig;
}
