# system2 — Automated Cabinet Manufacturing Operations System

A web-based OPS engine that batch-processes native **Polyboard** exports, renders
2D/3D previews, validates every panel, compiles native **bSolid-compliant
`.cix`** part programs for the **Biesse Rover A**, and distributes them across
the LAN to the machine and the nesting workstation.

> Polyboard batch → parse → validate → preview → `.cix` → network → labels/BOM.

---

## Quick start

```bash
npm install          # installs deps + vendors Three.js into public/vendor
npm run sample       # (optional) regenerate the bundled demo kitchen
npm run dev          # starts the OPS server on http://localhost:4000
```

Open **http://localhost:4000** in Chrome/Edge, then click **▶ Load sample** to
import the bundled demo kitchen (2 cabinets, 15 parts) and click through the
pipeline.

The app is fully self-contained (no CDN, no bundler) so it runs on offline
shop-floor workstations.

---

## What it does (mapped to the spec)

| Spec module | Implementation |
| --- | --- |
| **A — Batch ingestion & bulk parsing** | `src/parse/*` — drag-drop / folder picker in the browser, or server-side folder import (`POST /api/import-folder`). Parses Polyboard-style cutting-list `.txt`, assembly/hardware `.csv` and per-part `.dxf` (LWPOLYLINE/POLYLINE/LINE/ARC/CIRCLE/TEXT), groups parts by **Cabinet ID → Panel Type → Material Thickness**, extracts dimensions, material, grain, edge-banding, drillings, grooves/dados and assembly flags. Hardware coordinates are reconciled onto drill ops (Biesse tool mapping). |
| **B — Interactive 2D/3D viewer** | `public/js/viewer2d.js`, `viewer3d.js` — project tree sidebar; orthographic 2D panel view color-coding **face drillings**, **edge drillings**, **routing toolpaths** and **edge banding**; Three.js/WebGL 3D assembly preview with rotate/zoom/pan (OrbitControls); **pre-flight validation engine** (`src/validate.ts`) flags off-panel holes, overlapping holes, over-deep holes, missing dimensions, duplicate IDs, etc. |
| **C — CIX generation & network automation** | `src/cix.ts` — compiles each panel into a native-style `.cix` program (clean alphanumeric blocks, signed coordinates). `POST /api/projects/:id/distribute` writes the batch to every configured machine folder (local path or mounted SMB share). See [`docs/cix-format.md`](docs/cix-format.md). |
| **D — Shop-floor execution & tracking** | `src/reports.ts` — bills of materials + cost summary (`GET .../bom`, `/bom.csv`) and barcode-ready part labels (`GET .../labels`, Code-128 in `public/js/code128.js`), printable from the BOM tab. The data model has hooks for inventory/stock deduction. |

---

## Architecture

```
Browser (Chrome/Edge)                Node.js backend (tsx, no build step)
┌─────────────────────────┐          ┌─────────────────────────────────────┐
│ Three.js / WebGL        │  HTTP    │ server/index.ts                     │
│  - 2D panel viewer      │ ───────▶ │  - static hosting + REST API        │
│  - 3D assembly viewer   │  JSON    │  - project registry (data/state)    │
│  - project tree, tabs   │          │  - settings (data/settings.json)    │
│  - barcode labels       │ ◀─────── │                                     │
└─────────────────────────┘          │ src/parse  → panels, drillings, ... │
                                     │ src/validate → pre-flight report    │
                                     │ src/cix    → .cix compilation       │
                                     │ src/reports → BOM, labels, costs    │
                                     └───────────────┬─────────────────────┘
                                                     │ fs writes
                                                     ▼
                                    output/<project>/cix/   + LAN target folders
```

- **Shared data model:** `shared/types.ts` is the single source of truth
  (panels, drillings, grooves, edge-banding, placements, settings).
- **Persistence:** projects and settings persist to `data/` (git-ignored) so a
  restart keeps the batch. Compiled output lands in `output/`.
- **No build step:** the frontend is plain ES modules; Three.js and
  OrbitControls are vendored to `public/vendor` by `scripts/vendor.mjs`.

### Project layout

```
server/index.ts        HTTP server + REST API + network distribution
shared/types.ts        canonical data model
src/parse/             cutting-list, assembly/hardware, DXF parsers + importer
src/validate.ts        pre-flight validation engine
src/cix.ts             .cix compiler (Biesse bSolid block structure)
src/reports.ts         BOM, cost summary, part labels
src/settings.ts        workshop tooling / network / costing defaults
scripts/generate-sample.ts  realistic Polyboard-style demo export
public/                frontend (index.html, css, js, vendored three.js)
sample-data/           bundled demo project (cutting-list.txt, hardware.csv, *.dxf)
docs/cix-format.md     CIX block reference + safety notes
```

---

## Import formats

**Cutting-list `.txt`** — CSV/TSV with a header row. Columns are matched by
name (case-insensitive): `Cabinet, Part ID, Name, Panel Type, Material,
Thickness (mm), Width (mm), Height (mm), Qty, Grain, Edge L/R/B/T`.

**Assembly / hardware `.csv`** — `Part, Hardware, Face, X, Y, Z, Diameter,
Depth, Flag`. Rows key by part ID and merge onto panels; `dado`/`blind` kinds
add assembly flags.

**Part `.dxf`** — layer names classify geometry:
`OUTLINE`/`PANEL` (outline), `DRILLINGS`/`DRILL_TOP` (face drilling),
`DRILL_BOTTOM`, `DRILL_EDGE`/`EDGE`, `GROOVE`/`DADO` (routing). Units are read
from `$INSUNITS`. Parts are matched to cutting-list rows by the part ID in the
file name (e.g. `BASE-01-001-Left Side.dxf` → `001`).

---

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/import` | Ingest files `{name, files:[{name,content}]}` |
| `POST` | `/api/import-folder` | Ingest a server-side folder path |
| `POST` | `/api/load-sample` | Import the bundled demo kitchen |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/:id` | Project detail |
| `GET` | `/api/projects/:id/validation` | Pre-flight report |
| `POST` | `/api/projects/:id/compile` | Validate + compile `.cix` |
| `POST` | `/api/projects/:id/distribute` | Write `.cix` to network targets |
| `GET` | `/api/projects/:id/cix/:name` | Download one `.cix` file |
| `GET` | `/api/projects/:id/bom` / `/bom.csv` | BOM + cost summary |
| `GET` | `/api/projects/:id/labels` | Barcode label data |
| `GET`/`PUT` | `/api/settings` | Workshop configuration |

---

## Network distribution (SMB/LAN)

Settings → Network defines a **target directory** plus per-machine sub-folders
(e.g. `rover-a`, `nesting`). On distribute, the full batch is written into each
folder. For SMB shares, mount the share locally (Windows: map to `Z:\`; Linux:
`/mnt/workshop`) and set the target to that path — the app writes ordinary
files, so any NAS/NFS/SMB mount works. See `docs/cix-format.md` for machine-side
notes.

## ⚠️ CIX safety note

The `.cix` compiler implements the documented Biesse alphanumeric block
structure (see `docs/cix-format.md`), but **bSolid's exact dialect is
proprietary and machine/post-processor specific**. Always dry-run the output on
the real Rover A (and against your bSolid post-processor) before production,
and treat the `prelude`/`postlude` templates in `src/cix.ts` as the hook for
your machine's header blocks.
