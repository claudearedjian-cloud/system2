# system2 — Unified Woodworking Operations Engine (Polyboard → Cut Rite / bSolid Pipeline)

A responsive, web-based shop floor operations application that intercepts data from **Polyboard**, processes it simultaneously for raw sheet cutting (**Holzma / Cut Rite**) and CNC secondary machining (**Biesse Rover A Pod-and-Rail**), and creates an interactive tracking environment for the assembly zone using barcode scans.

> Polyboard Batch Export ➔ Cut Rite Optimization CSV & Labels + bSolid `.cix` Machine Programs ➔ LAN Network Push ➔ Touchscreen Assembly Tracking & 3D Highlighting.

---

## Target Infrastructure

- **Beam Saw:** Holzma HPP via Cut Rite optimization software (raw sheet cutting, grain optimization, edging specs, initial barcode labeling).
- **CNC Machine:** Biesse Rover A (Pod-and-Rail machine utilizing native `.cix` instruction packages for face drilling, edge boring aggregates, and routing).
- **Tracking Stations:** Shop floor touchscreen tablets equipped with hardware USB/Bluetooth keyboard-emulated barcode readers.

---

## Quick Start

```bash
npm install          # installs deps + vendors Three.js into public/vendor
npm run sample       # regenerate the bundled demo kitchen (2 cabinets, 15 parts)
npm run dev          # starts the OPS server on http://localhost:4000
```

Open **http://localhost:4000** in Chrome/Edge, then click **▶ Sample** to load the bundled demo kitchen.

The application is self-contained (zero CDN dependencies) and optimized for offline shop-floor workstations and touch tablets.

---

## System Modules & Implementation

### Module A: Multi-Track Data Ingestion & Splitting
- **Bulk Import Engine (`src/parse/*`):** Ingests Polyboard exports containing cutting lists (`.txt`), material specifications, assembly/hardware lists (`.csv`), and geometric DXFs (`.dxf`).
- **Cut Rite Pipeline (`src/cutrite.ts`):** Formats raw structural dimensions, grain directions (`0=none, 1=length, 2=width`), quantities, and edge banding (`L1, L2, W1, W2`) into a standardized CSV import file compatible with Cut Rite optimization (`GET /api/projects/:id/cutrite.csv`).
- **bSolid CIX Pipeline (`src/cix.ts`):** Extracts secondary tooling coordinates (hinge pockets, drawer slide holes, shelf pins, perimeter routing) and maps them against the active Biesse tooling spindle array.
- **File Name Synchronization:** Programmatically enforces a shared structural naming convention. The part identifier passed to Cut Rite matches the alphanumeric filename of the generated bSolid `.cix` file and the printed Code-128 barcode value (e.g. `BASE-01-001` / `BASE-01-001.cix`).

### Module B: Intelligent .cix Compilation (Pod-and-Rail Optimizations)
- **Native CIX Generation (`src/cix.ts`):** Programmatically outputs clean ASCII-text `.cix` instruction packages ready for bSolid.
- **Origin Setup & Pod-and-Rail Field Layout:** Workpiece setup referencing Stop 1 (`ORIGIN 1`), clearance planes (`ZSF +50.00`), pod clamping safe zones, and edge-boring aggregate offsets (`EDGE L/R/B/T`).
- **Spindle Array Mapping:** Vertical boring head mapping (`Spindle 1: Ø5mm`, `Spindle 2: Ø8mm`, `Spindle 3: Ø35mm hinge cups`).
- **Automated Network Drop (`POST /api/projects/:id/distribute`):** Pushes compiled `.cix` batches over the LAN to configured machine folders (e.g. `/mnt/workshop/rover-a` or mounted SMB shares).

### Module C: Interactive Production & Assembly Tracking Loop
- **Persistent Production Database (`server/index.ts` & `data/state.json`):** Stores project hierarchies (`Project -> Cabinet ID -> Component Parts`) and tracks production status (`pending_cut` → `cut_ready` → `machined` → `staged` → `assembled`).
- **Multi-Station UI Modes:**
  1. **Assembly Zone:** Touchscreen interface for assembly technicians with 3D model, parts checklist, and hardware cards.
  2. **CNC Rover A Station:** Operator screen displaying pod clamping setups, spindle array mapping, 2D machining view, and CIX code.
  3. **Cut Rite Saw Station:** Sheet cutting table, Cut Rite CSV export, and printable barcode labels.
  4. **CAM & Pre-Flight:** 2D CAD viewer, safety validation engine, and workshop settings.
- **Global Barcode Input Listener (`public/js/barcode.js`):** Listens window-wide for rapid keystroke bursts (<40ms) from USB/Bluetooth handheld barcode scanners (Keyboard Emulation Mode) ending in `Enter`.

### Module D: Assembly Zone UI & Component Highlighter
- **Real-Time Barcode Lookup (`POST /api/scan`):** Instant database query resolving Part ID and parent Cabinet ID from scanned barcode strings.
- **Dynamic 3-Panel Screen Rendering:**
  - **Left Panel (Cabinet Checklist):** Displays full cabinet parts checklist with progress bar (`e.g. 4 / 8 Parts Staged (50%)`). Automatically checks off scanned pieces and marks them as "Staged for Assembly".
  - **Center Panel (Three.js WebGL 3D Renderer):** Displays an interactive 3D model of the assembled cabinet. **The scanned part flashes with a pulsing bright green glow (`#22c55e`)** relative to the rest of the assembly. Includes an **Exploded View slider** (0% to 100%) and **Ghost Mode** toggle.
  - **Right Panel (Hardware Detail Cards):** Displays visual cards with graphic icons (`🚪 Hinge 35mm`, `🗄️ Drawer Slide`, `📍 Shelf Pin 5mm`, `🪵 Dowel 8mm`, `🔗 Minifix`, `🪛 Back Screw`) showing coordinates `(X, Y, Z)`, face orientation, and pre-assembly instructions.

---

## REST API Reference

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/scan` | Global hardware barcode scan endpoint (updates status & returns cabinet 3D highlight data) |
| `POST` | `/api/load-sample` | Imports bundled kitchen demo batch (15 parts, 2 cabinets) |
| `POST` | `/api/import` | Ingests uploaded Polyboard batch files |
| `POST` | `/api/import-folder` | Ingests server-side export directory |
| `GET` | `/api/projects` | Lists all imported projects and statistics |
| `GET` | `/api/projects/:id` | Full project detail (cabinets, panels, 3D placements) |
| `GET` | `/api/projects/:id/validation` | Pre-flight safety validation report |
| `POST` | `/api/projects/:id/compile` | Compiles synchronized bSolid `.cix` instruction packages |
| `POST` | `/api/projects/:id/distribute` | Pushes `.cix` batch across LAN network targets |
| `GET` | `/api/projects/:id/cutrite` | Cut Rite optimization summary report |
| `GET` | `/api/projects/:id/cutrite.csv` | Standard Cut Rite optimization CSV download |
| `GET` | `/api/projects/:id/cix/:name` | Downloads individual `.cix` part program |
| `GET` | `/api/projects/:id/bom` / `/bom.csv` | BOM, cost summary, and BOM CSV |
| `GET` | `/api/projects/:id/labels` | Thermal Barcode label dataset |
| `POST` | `/api/projects/:id/parts/:pid/status` | Updates individual part production tracking status |
| `POST` | `/api/projects/:id/reset-status` | Resets project part statuses to `pending_cut` |
| `GET`/`PUT` | `/api/settings` | Reads / writes workshop tooling, LAN paths, and costing settings |
