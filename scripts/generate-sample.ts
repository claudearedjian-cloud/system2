/**
 * Generates a realistic Polyboard-style sample export for a small kitchen:
 * two cabinets (one base, one wall) with cutting-list text, assembly CSV and
 * per-part DXF files (outline, face drillings, edge drillings, grooves).
 *
 * Usage: npm run sample   → writes to sample-data/kitchen-demo/
 */
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'sample-data', 'kitchen-demo');

interface PartDef {
  partId: string;
  cabinet: string;
  name: string;
  panelType: string;
  material: string;
  thickness: number;
  width: number;
  height: number;
  qty: number;
  grain: 'vertical' | 'horizontal' | 'none';
  edgeL: string;
  edgeR: string;
  edgeB: string;
  edgeT: string;
  drillings: { layer: string; x: number; y: number; d: number }[];
  grooves?: { x1: number; y1: number; x2: number; y2: number; width: number; depth: number }[];
  hardware?: { kind: string; face: string; x: number; y: number; z: number; d?: number; depth?: number; flag?: string }[];
}

const BASE = 'BASE-01';
const WALL = 'WALL-01';

const parts: PartDef[] = [
  // -------- Base cabinet 600w x 720h x 560d --------------------------------
  {
    partId: '001', cabinet: BASE, name: 'Left Side', panelType: 'Left Side',
    material: '18mm Melamine White', thickness: 18, width: 560, height: 720, qty: 1,
    grain: 'vertical', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [
      { layer: 'DRILLINGS', x: 30, y: 90, d: 5 },
      { layer: 'DRILLINGS', x: 30, y: 250, d: 5 },
      { layer: 'DRILLINGS', x: 30, y: 410, d: 5 },
      { layer: 'DRILLINGS', x: 30, y: 570, d: 5 },
    ],
    grooves: [{ x1: 20, y1: 0, x2: 20, y2: 560, width: 8, depth: 8 }],
    hardware: [
      { kind: 'shelf pin 5mm', face: 'edge', x: 90, y: 0, z: 30, d: 5, depth: 8 },
      { kind: 'shelf pin 5mm', face: 'edge', x: 250, y: 0, z: 30, d: 5, depth: 8 },
      { kind: 'shelf pin 5mm', face: 'edge', x: 410, y: 0, z: 30, d: 5, depth: 8 },
      { kind: 'shelf pin 5mm', face: 'edge', x: 570, y: 0, z: 30, d: 5, depth: 8 },
    ],
  },
  {
    partId: '002', cabinet: BASE, name: 'Right Side', panelType: 'Right Side',
    material: '18mm Melamine White', thickness: 18, width: 560, height: 720, qty: 1,
    grain: 'vertical', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [
      { layer: 'DRILLINGS', x: 530, y: 90, d: 5 },
      { layer: 'DRILLINGS', x: 530, y: 250, d: 5 },
      { layer: 'DRILLINGS', x: 530, y: 410, d: 5 },
      { layer: 'DRILLINGS', x: 530, y: 570, d: 5 },
    ],
    grooves: [{ x1: 540, y1: 0, x2: 540, y2: 560, width: 8, depth: 8 }],
  },
  {
    partId: '003', cabinet: BASE, name: 'Bottom', panelType: 'Bottom',
    material: '18mm Melamine White', thickness: 18, width: 564, height: 560, qty: 1,
    grain: 'horizontal', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [{ layer: 'DRILLINGS', x: 282, y: 40, d: 8 }],
  },
  {
    partId: '004', cabinet: BASE, name: 'Top', panelType: 'Top',
    material: '18mm Melamine White', thickness: 18, width: 564, height: 560, qty: 1,
    grain: 'horizontal', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [
      { layer: 'DRILLINGS', x: 282, y: 40, d: 8 },
      { layer: 'DRILLINGS', x: 282, y: 300, d: 8 },
    ],
    hardware: [
      { kind: 'dowel 8mm through', face: 'top', x: 282, y: 300, z: 0, d: 8, depth: 18 },
    ],
  },
  {
    partId: '005', cabinet: BASE, name: 'Back', panelType: 'Back',
    material: '8mm MDF', thickness: 8, width: 600, height: 720, qty: 1,
    grain: 'none', edgeL: '', edgeR: '', edgeB: '', edgeT: '',
    drillings: [{ layer: 'DRILLINGS', x: 300, y: 360, d: 5 }],
    hardware: [
      { kind: 'back screw 5mm', face: 'top', x: 300, y: 360, z: 0, d: 5, depth: 8 },
    ],
  },
  {
    partId: '006', cabinet: BASE, name: 'Shelf', panelType: 'Shelf',
    material: '18mm Melamine White', thickness: 18, width: 528, height: 540, qty: 1,
    grain: 'horizontal', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [{ layer: 'DRILLINGS', x: 40, y: 30, d: 5 }],
  },
  {
    partId: '007', cabinet: BASE, name: 'Door Left', panelType: 'Door',
    material: '18mm Melamine Beech', thickness: 18, width: 297, height: 700, qty: 1,
    grain: 'vertical', edgeL: 'ABS 1mm', edgeR: 'ABS 1mm', edgeB: 'ABS 1mm', edgeT: 'ABS 1mm',
    drillings: [
      { layer: 'DRILLINGS', x: 40, y: 120, d: 35 },
      { layer: 'DRILLINGS', x: 40, y: 580, d: 35 },
    ],
    hardware: [
      { kind: 'hinge 35mm cup', face: 'top', x: 40, y: 120, z: 0, d: 35, depth: 11 },
      { kind: 'hinge 35mm cup', face: 'top', x: 40, y: 580, z: 0, d: 35, depth: 11 },
    ],
  },
  {
    partId: '008', cabinet: BASE, name: 'Door Right', panelType: 'Door',
    material: '18mm Melamine Beech', thickness: 18, width: 297, height: 700, qty: 1,
    grain: 'vertical', edgeL: 'ABS 1mm', edgeR: 'ABS 1mm', edgeB: 'ABS 1mm', edgeT: 'ABS 1mm',
    drillings: [
      { layer: 'DRILLINGS', x: 257, y: 120, d: 35 },
      { layer: 'DRILLINGS', x: 257, y: 580, d: 35 },
    ],
    hardware: [
      { kind: 'hinge 35mm cup', face: 'top', x: 257, y: 120, z: 0, d: 35, depth: 11 },
      { kind: 'hinge 35mm cup', face: 'top', x: 257, y: 580, z: 0, d: 35, depth: 11 },
    ],
  },

  // -------- Wall cabinet 600w x 700h x 320d --------------------------------
  {
    partId: '101', cabinet: WALL, name: 'Left Side', panelType: 'Left Side',
    material: '18mm Melamine White', thickness: 18, width: 320, height: 700, qty: 1,
    grain: 'vertical', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [
      { layer: 'DRILLINGS', x: 30, y: 150, d: 5 },
      { layer: 'DRILLINGS', x: 30, y: 300, d: 5 },
      { layer: 'DRILLINGS', x: 30, y: 450, d: 5 },
    ],
    hardware: [
      { kind: 'shelf pin 5mm', face: 'edge', x: 150, y: 0, z: 30, d: 5, depth: 8 },
      { kind: 'shelf pin 5mm', face: 'edge', x: 300, y: 0, z: 30, d: 5, depth: 8 },
      { kind: 'shelf pin 5mm', face: 'edge', x: 450, y: 0, z: 30, d: 5, depth: 8 },
    ],
  },
  {
    partId: '102', cabinet: WALL, name: 'Right Side', panelType: 'Right Side',
    material: '18mm Melamine White', thickness: 18, width: 320, height: 700, qty: 1,
    grain: 'vertical', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [
      { layer: 'DRILLINGS', x: 290, y: 150, d: 5 },
      { layer: 'DRILLINGS', x: 290, y: 300, d: 5 },
      { layer: 'DRILLINGS', x: 290, y: 450, d: 5 },
    ],
  },
  {
    partId: '103', cabinet: WALL, name: 'Bottom', panelType: 'Bottom',
    material: '18mm Melamine White', thickness: 18, width: 564, height: 320, qty: 1,
    grain: 'horizontal', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [{ layer: 'DRILLINGS', x: 282, y: 40, d: 8 }],
  },
  {
    partId: '104', cabinet: WALL, name: 'Top', panelType: 'Top',
    material: '18mm Melamine White', thickness: 18, width: 564, height: 320, qty: 1,
    grain: 'horizontal', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [{ layer: 'DRILLINGS', x: 282, y: 40, d: 8 }],
  },
  {
    partId: '105', cabinet: WALL, name: 'Back', panelType: 'Back',
    material: '8mm MDF', thickness: 8, width: 600, height: 700, qty: 1,
    grain: 'none', edgeL: '', edgeR: '', edgeB: '', edgeT: '',
    drillings: [{ layer: 'DRILLINGS', x: 300, y: 350, d: 5 }],
    hardware: [
      { kind: 'back screw 5mm', face: 'top', x: 300, y: 350, z: 0, d: 5, depth: 8 },
    ],
  },
  {
    partId: '106', cabinet: WALL, name: 'Shelf', panelType: 'Shelf',
    material: '18mm Melamine White', thickness: 18, width: 528, height: 302, qty: 2,
    grain: 'horizontal', edgeL: 'ABS 1mm', edgeR: '', edgeB: '', edgeT: '',
    drillings: [{ layer: 'DRILLINGS', x: 40, y: 30, d: 5 }],
  },
  {
    partId: '107', cabinet: WALL, name: 'Door', panelType: 'Door',
    material: '18mm Melamine Beech', thickness: 18, width: 597, height: 696, qty: 1,
    grain: 'horizontal', edgeL: 'ABS 1mm', edgeR: 'ABS 1mm', edgeB: 'ABS 1mm', edgeT: 'ABS 1mm',
    drillings: [
      { layer: 'DRILLINGS', x: 60, y: 120, d: 35 },
      { layer: 'DRILLINGS', x: 60, y: 576, d: 35 },
    ],
    hardware: [
      { kind: 'hinge 35mm cup', face: 'top', x: 60, y: 120, z: 0, d: 35, depth: 11 },
      { kind: 'hinge 35mm cup', face: 'top', x: 60, y: 576, z: 0, d: 35, depth: 11 },
    ],
  },
];

// ---------------------------------------------------------------------------

function cuttingListHeader(): string {
  return 'Cabinet,Part ID,Name,Panel Type,Material,Thickness (mm),Width (mm),Height (mm),Qty,Grain,Edge L,Edge R,Edge B,Edge T';
}

function cuttingListCsv(): string {
  const rows = parts.map((p) =>
    [
      p.cabinet,
      p.partId,
      p.name,
      p.panelType,
      p.material,
      p.thickness,
      p.width,
      p.height,
      p.qty,
      p.grain,
      p.edgeL,
      p.edgeR,
      p.edgeB,
      p.edgeT,
    ].join(','),
  );
  return [cuttingListHeader(), ...rows].join('\n') + '\n';
}

function hardwareCsv(): string {
  const rows: string[] = [];
  for (const p of parts) {
    for (const h of p.hardware ?? []) {
      rows.push([p.partId, h.kind, h.face, h.x, h.y, h.z, h.d ?? '', h.depth ?? '', h.flag ?? ''].join(','));
    }
  }
  return ['Part,Hardware,Face,X,Y,Z,Diameter,Depth,Flag', ...rows].join('\n') + '\n';
}

function dxf(part: PartDef): string {
  const L: string[] = [];
  L.push('0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC');
  L.push('0', 'SECTION', '2', 'ENTITIES');

  // Outline on OUTLINE layer.
  L.push('0', 'LWPOLYLINE', '8', 'OUTLINE', '90', '4', '70', '1');
  const corners = [
    [0, 0],
    [part.width, 0],
    [part.width, part.height],
    [0, part.height],
  ];
  for (const [x, y] of corners) L.push('10', x.toFixed(2), '20', y.toFixed(2));

  // Drillings.
  for (const d of part.drillings) {
    L.push('0', 'CIRCLE', '8', d.layer, '10', d.x.toFixed(2), '20', d.y.toFixed(2), '40', (d.d / 2).toFixed(2));
  }

  // Grooves.
  for (const g of part.grooves ?? []) {
    L.push('0', 'LWPOLYLINE', '8', 'GROOVE', '90', '2', '70', '0');
    L.push('10', g.x1.toFixed(2), '20', g.y1.toFixed(2));
    L.push('10', g.x2.toFixed(2), '20', g.y2.toFixed(2));
  }

  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\n') + '\n';
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(join(OUT, 'cutting-list.txt'), cuttingListCsv(), 'utf8');
  await fs.writeFile(join(OUT, 'hardware.csv'), hardwareCsv(), 'utf8');
  for (const p of parts) {
    const fname = `${p.cabinet}-${p.partId}-${p.name.replace(/\s+/g, '_')}.dxf`;
    await fs.writeFile(join(OUT, fname), dxf(p), 'utf8');
  }
  const count = parts.length + 2;
  console.log(`[sample] wrote ${count} files to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
