/**
 * system2 backend: static hosting + batch-processing API.
 *
 * REST Endpoints:
 *   POST /api/import                   ingest a batch of files
 *   GET  /api/projects                 list projects
 *   GET  /api/projects/:id             project detail (includes placements)
 *   GET  /api/projects/:id/validation  pre-flight safety report
 *   POST /api/projects/:id/compile     validate + generate .cix files
 *   POST /api/projects/:id/distribute  write .cix to the network target
 *   GET  /api/projects/:id/bom         bill of materials
 *   GET  /api/projects/:id/bom.csv     BOM CSV export
 *   GET  /api/projects/:id/cutrite     Cut Rite optimization report
 *   GET  /api/projects/:id/cutrite.csv Cut Rite CSV download
 *   GET  /api/projects/:id/labels      barcode label data
 *   GET  /api/projects/:id/cix/:name   download one .cix file
 *   POST /api/scan                     global hardware barcode scan lookup & stage
 *   POST /api/projects/:id/parts/:pid/status update part production status
 *   POST /api/projects/:id/reset-status reset all part statuses to pending_cut
 *   GET/PUT /api/settings              workshop configuration
 *   POST /api/import-folder            ingest from a server-side folder path
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Cabinet, HardwareCategory, Panel, PartStatus, Project, ScanResult, Settings } from '../shared/types.js';
import { importBatch, type ImportFile } from '../src/parse/index.js';
import { validateProject } from '../src/validate.js';
import { compileProject, compilePanel, panelFileName } from '../src/cix.js';
import { buildBom, buildLabels, bomToCsv } from '../src/reports.js';
import { buildCutRiteReport } from '../src/cutrite.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const OUTPUT_DIR = join(ROOT, 'output');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const STATE_FILE = join(DATA_DIR, 'state.json');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const projects = new Map<string, Project>();
let settings: Settings = DEFAULT_SETTINGS;

function refreshProjectStats(p: Project) {
  const allPanels = p.cabinets.flatMap((c) => c.panels);
  p.stats.panels = allPanels.length;
  p.stats.partInstances = allPanels.reduce((s, x) => s + x.qty, 0);
  p.stats.materials = [...new Set(allPanels.map((x) => x.material))].filter((m) => m && m !== 'Unknown');
  p.stats.thicknesses = [...new Set(allPanels.map((x) => x.thickness))].sort((a, b) => a - b);
  p.stats.statusSummary = {
    pendingCut: allPanels.reduce((s, x) => s + (x.status === 'pending_cut' ? x.qty : 0), 0),
    cutReady: allPanels.reduce((s, x) => s + (x.status === 'cut_ready' ? x.qty : 0), 0),
    machined: allPanels.reduce((s, x) => s + (x.status === 'machined' ? x.qty : 0), 0),
    staged: allPanels.reduce((s, x) => s + (x.status === 'staged' ? x.qty : 0), 0),
    assembled: allPanels.reduce((s, x) => s + (x.status === 'assembled' ? x.qty : 0), 0),
  };
}

function loadState() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) } as Settings;
    }
    if (existsSync(STATE_FILE)) {
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      for (const p of state.projects ?? []) {
        // Ensure all panels have synced fields and status
        for (const cab of p.cabinets ?? []) {
          for (const pan of cab.panels ?? []) {
            if (!pan.partCode) pan.partCode = (pan.id || '').replace(/[^A-Za-z0-9_-]/g, '_').toUpperCase();
            if (!pan.cixFileName) pan.cixFileName = `${pan.partCode}.cix`;
            if (!pan.barcode) pan.barcode = pan.partCode;
            if (!pan.status) pan.status = 'pending_cut';
          }
        }
        refreshProjectStats(p);
        projects.set(p.id, p);
      }
    }
  } catch (e) {
    console.error('[state] failed to load:', (e as Error).message);
  }
}

function saveState() {
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    writeFileSync(STATE_FILE, JSON.stringify({ projects: [...projects.values()] }, null, 2), 'utf8');
  } catch (e) {
    console.error('[state] failed to save:', (e as Error).message);
  }
}

loadState();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json(res: ServerResponse, code: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 256 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res: ServerResponse, pathname: string) {
  let filePath = join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(PUBLIC_DIR, 'index.html'); // SPA fallback
  }
  fs.readFile(filePath)
    .then((buf) => {
      const ext = extname(filePath).toLowerCase();
      const noCache = ['.html', '.js', '.mjs', '.css', '.json'].includes(ext);
      const headers: Record<string, string> = {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
      };
      if (noCache) headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      res.writeHead(200, headers);
      res.end(buf);
    })
    .catch(() => {
      res.writeHead(404).end('not found');
    });
}

async function importFolder(folderPath: string) {
  const resolved = resolve(folderPath);
  const files: ImportFile[] = [];
  const walk = async (dir: string) => {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const full = join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else if (/\.(txt|csv|dxf)$/i.test(item.name)) {
        files.push({ name: item.name, path: full, content: await fs.readFile(full, 'utf8') });
      }
    }
  };
  await walk(resolved);
  return files;
}

function calculateCabinetStats(cabinet: Cabinet) {
  const total = cabinet.panels.length;
  let pendingCut = 0;
  let cutReady = 0;
  let machined = 0;
  let staged = 0;
  let assembled = 0;

  for (const p of cabinet.panels) {
    if (p.status === 'pending_cut') pendingCut += p.qty;
    else if (p.status === 'cut_ready') cutReady += p.qty;
    else if (p.status === 'machined') machined += p.qty;
    else if (p.status === 'staged') staged += p.qty;
    else if (p.status === 'assembled') assembled += p.qty;
  }

  const done = staged + assembled;
  const totalInstances = cabinet.panels.reduce((s, p) => s + p.qty, 0);
  const percentComplete = totalInstances > 0 ? Math.round((done / totalInstances) * 100) : 0;

  return {
    total,
    totalInstances,
    pendingCut,
    cutReady,
    machined,
    staged,
    assembled,
    percentComplete,
  };
}

function buildHardwareInstructions(panel: Panel) {
  return panel.hardware.map((h, i) => {
    const cat: HardwareCategory = h.category || 'other';
    let icon = '🔩';
    let instruction = `Mount ${h.kind} on ${h.face} face`;

    if (cat === 'hinge') {
      icon = '🚪';
      instruction = `Press-fit 35mm hinge cup at (${h.x}, ${h.y}) mm`;
    } else if (cat === 'slide') {
      icon = '🗄️';
      instruction = `Attach drawer slide runner along ${h.face} face at Y=${h.y}mm`;
    } else if (cat === 'shelf_pin') {
      icon = '📍';
      instruction = `Insert 5mm shelf support pin into hole at (${h.x}, ${h.y}) mm`;
    } else if (cat === 'dowel') {
      icon = '🪵';
      instruction = `Insert 8mm wooden dowel into ${h.face === 'edge' ? `${h.edge || 'edge'} face` : 'face'} at (${h.x}, ${h.y}) mm`;
    } else if (cat === 'connector') {
      icon = '🔗';
      instruction = `Install Minifix / cam connector housing at (${h.x}, ${h.y}) mm`;
    } else if (cat === 'screw') {
      icon = '🪛';
      instruction = `Fasten back panel screw at (${h.x}, ${h.y}) mm`;
    }

    return {
      id: h.id || `${panel.id}-HW-${i + 1}`,
      kind: h.kind,
      category: cat,
      face: h.face,
      edge: h.edge,
      x: h.x,
      y: h.y,
      z: h.z,
      diameter: h.diameter,
      depth: h.depth,
      qty: h.qty || 1,
      icon,
      instruction,
    };
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
  const { pathname } = url;
  const method = req.method ?? 'GET';

  try {
    // -- API -----------------------------------------------------------------
    if (pathname === '/api/settings') {
      if (method === 'GET') return json(res, 200, settings);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        settings = { ...DEFAULT_SETTINGS, ...body };
        saveState();
        return json(res, 200, settings);
      }
    }

    // Global Barcode Scanner Endpoint (Module C & D)
    if (pathname === '/api/scan' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const rawBarcode = String(body.barcode || '').trim();
      const station = (body.station || 'assembly') as 'saw' | 'cnc' | 'assembly' | 'manual';
      const targetProjectId = body.projectId as string | undefined;

      if (!rawBarcode) {
        return json(res, 400, { found: false, barcode: '', message: 'Empty barcode received' });
      }

      // Normalize barcode search string (strip prefixes like P:, whitespace, trailing .cix)
      const cleanBarcode = rawBarcode.replace(/^P:/i, '').replace(/\.cix$/i, '').trim();
      const cleanLower = cleanBarcode.toLowerCase();

      // Find matching panel across projects
      let matchedProject: Project | undefined;
      let matchedCabinet: Cabinet | undefined;
      let matchedPanel: Panel | undefined;

      const projectList = targetProjectId && projects.has(targetProjectId)
        ? [projects.get(targetProjectId)!]
        : [...projects.values()].reverse();

      for (const p of projectList) {
        for (const cab of p.cabinets) {
          for (const pan of cab.panels) {
            const panCode = (pan.partCode || '').toLowerCase();
            const panId = pan.id.toLowerCase();
            const panBar = (pan.barcode || '').replace(/^P:/i, '').toLowerCase();
            const panName = pan.name.toLowerCase();
            const panCix = (pan.cixFileName || '').replace(/\.cix$/i, '').toLowerCase();
            const panNum = pan.id.split('-').pop()?.toLowerCase();

            if (
              panCode === cleanLower ||
              panId === cleanLower ||
              panBar === cleanLower ||
              panCix === cleanLower ||
              panNum === cleanLower ||
              rawBarcode.toLowerCase() === pan.barcode?.toLowerCase() ||
              rawBarcode.toLowerCase() === `p:${pan.barcode?.toLowerCase()}` ||
              (cleanLower.length >= 3 && panId.endsWith(`-${cleanLower}`))
            ) {
              matchedProject = p;
              matchedCabinet = cab;
              matchedPanel = pan;
              break;
            }
          }
          if (matchedPanel) break;
        }
        if (matchedPanel) break;
      }

      if (!matchedProject || !matchedCabinet || !matchedPanel) {
        return json(res, 404, {
          found: false,
          barcode: rawBarcode,
          station,
          message: `Part with barcode "${rawBarcode}" not found in current project database.`,
        });
      }

      // Update part status based on station
      const prevStatus = matchedPanel.status || 'pending_cut';
      let nextStatus = prevStatus;
      const now = new Date().toISOString();

      if (station === 'assembly') {
        // Assembly zone logic: advance to 'staged' or 'assembled'
        if (prevStatus === 'pending_cut' || prevStatus === 'cut_ready' || prevStatus === 'machined') {
          nextStatus = 'staged';
          matchedPanel.stagedAt = now;
        } else if (prevStatus === 'staged') {
          nextStatus = 'assembled';
          matchedPanel.assembledAt = now;
        }
      } else if (station === 'cnc') {
        // CNC Station logic: mark machined
        nextStatus = 'machined';
        matchedPanel.machinedAt = now;
      } else if (station === 'saw') {
        // Beam Saw station: mark cut_ready
        nextStatus = 'cut_ready';
      }

      matchedPanel.status = nextStatus;
      matchedPanel.scannedAt = now;
      if (!matchedPanel.history) matchedPanel.history = [];
      matchedPanel.history.push({
        timestamp: now,
        fromStatus: prevStatus,
        toStatus: nextStatus,
        station,
        note: `Barcode scanned at ${station.toUpperCase()} station: ${rawBarcode}`,
      });

      refreshProjectStats(matchedProject);
      saveState();

      const cabinetStats = calculateCabinetStats(matchedCabinet);
      const hardwareList = buildHardwareInstructions(matchedPanel);

      const result: ScanResult = {
        found: true,
        projectId: matchedProject.id,
        cabinetId: matchedCabinet.id,
        panelId: matchedPanel.id,
        partCode: matchedPanel.partCode,
        cabinetName: matchedCabinet.name,
        panelName: matchedPanel.name,
        barcode: rawBarcode,
        station,
        previousStatus: prevStatus,
        newStatus: nextStatus,
        panel: matchedPanel,
        cabinet: matchedCabinet,
        cabinetStats,
        message: `✔ Scanned [${matchedPanel.partCode}] ${matchedPanel.name} → Marked as ${nextStatus.toUpperCase().replace('_', ' ')} (${cabinetStats.percentComplete}% cabinet complete)`,
      };

      return json(res, 200, { ...result, hardwareList });
    }

    if (pathname === '/api/import' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const files: ImportFile[] = (body.files ?? []).map((f: { name: string; content: string; path?: string }) => ({
        name: f.name,
        path: f.path ?? `/upload/${f.name}`,
        content: f.content,
      }));
      if (!files.length) return json(res, 400, { error: 'No files provided' });

      const name = body.name?.trim() || deriveProjectName(files);
      const { project, unmatched } = importBatch(files);
      project.name = name;
      project.sourcePath = body.sourcePath ?? undefined;
      refreshProjectStats(project);
      projects.set(project.id, project);
      saveState();
      return json(res, 200, { projectId: project.id, project, unmatched });
    }

    if (pathname === '/api/load-sample' && method === 'POST') {
      const sampleDir = join(ROOT, 'sample-data', 'kitchen-demo');
      if (!existsSync(sampleDir)) return json(res, 400, { error: 'Sample data not found — run `npm run sample` first.' });
      const files = await importFolder(sampleDir);
      const { project, unmatched } = importBatch(files);
      project.name = 'Kitchen Demo (Polyboard Batch)';
      refreshProjectStats(project);
      projects.set(project.id, project);
      saveState();
      return json(res, 200, { projectId: project.id, project, unmatched });
    }

    if (pathname === '/api/import-folder' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const folder = body.folder;
      if (!folder) return json(res, 400, { error: 'No folder path provided' });
      const files = await importFolder(folder);
      if (!files.length) return json(res, 400, { error: `No .txt/.csv/.dxf files found in ${folder}` });
      const { project, unmatched } = importBatch(files);
      project.name = body.name?.trim() || folder.split(/[\\/]/).filter(Boolean).pop() || 'Imported project';
      refreshProjectStats(project);
      projects.set(project.id, project);
      saveState();
      return json(res, 200, { projectId: project.id, project, unmatched });
    }

    if (pathname === '/api/projects' && method === 'GET') {
      const list = [...projects.values()].map((p) => ({
        id: p.id,
        name: p.name,
        importedAt: p.importedAt,
        stats: p.stats,
      }));
      return json(res, 200, list);
    }

    const projMatch = pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
    if (projMatch) {
      const id = decodeURIComponent(projMatch[1]);
      const project = projects.get(id);
      if (!project) return json(res, 404, { error: 'Project not found' });
      const sub = projMatch[2] ?? '';

      if (sub === '' && method === 'GET') return json(res, 200, project);
      if (sub === '' && method === 'DELETE') {
        projects.delete(id);
        saveState();
        return json(res, 200, { ok: true });
      }

      if (sub === '/validation') return json(res, 200, validateProject(project));

      // Reset all part tracking statuses
      if (sub === '/reset-status' && method === 'POST') {
        for (const cab of project.cabinets) {
          for (const pan of cab.panels) {
            pan.status = 'pending_cut';
            pan.scannedAt = undefined;
            pan.machinedAt = undefined;
            pan.stagedAt = undefined;
            pan.assembledAt = undefined;
            pan.history = [
              {
                timestamp: new Date().toISOString(),
                fromStatus: 'pending_cut',
                toStatus: 'pending_cut',
                station: 'manual',
                note: 'Reset tracking status to pending_cut',
              },
            ];
          }
        }
        refreshProjectStats(project);
        saveState();
        return json(res, 200, { ok: true, stats: project.stats });
      }

      // Update part status directly
      const partStatusMatch = sub.match(/^\/parts\/([^/]+)\/status$/);
      if (partStatusMatch && method === 'POST') {
        const partId = decodeURIComponent(partStatusMatch[1]);
        const body = JSON.parse(await readBody(req));
        const newStatus = body.status as PartStatus;
        const station = (body.station || 'manual') as 'saw' | 'cnc' | 'assembly' | 'manual';

        const panel = project.cabinets.flatMap((c) => c.panels).find((p) => p.id === partId || p.partCode === partId);
        if (!panel) return json(res, 404, { error: 'Part not found' });

        const prev = panel.status;
        panel.status = newStatus;
        const now = new Date().toISOString();
        if (newStatus === 'machined') panel.machinedAt = now;
        if (newStatus === 'staged') panel.stagedAt = now;
        if (newStatus === 'assembled') panel.assembledAt = now;

        if (!panel.history) panel.history = [];
        panel.history.push({
          timestamp: now,
          fromStatus: prev,
          toStatus: newStatus,
          station,
          note: body.note || `Status changed to ${newStatus}`,
        });

        refreshProjectStats(project);
        saveState();

        const cabinet = project.cabinets.find((c) => c.panels.some((p) => p.id === panel.id));
        const cabinetStats = cabinet ? calculateCabinetStats(cabinet) : undefined;

        return json(res, 200, { ok: true, panel, cabinetStats, stats: project.stats });
      }

      if (sub === '/compile' && method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const merged: Settings = { ...settings, ...(body.settings ?? {}) };
        const validation = validateProject(project);
        const files = validation.ok ? compileProject(project, merged, validation) : [];
        const outDir = join(OUTPUT_DIR, safeName(project.name), 'cix');
        if (files.length) {
          mkdirSync(outDir, { recursive: true });
          for (const f of files) await fs.writeFile(join(outDir, f.name), f.content, 'utf8');
        }
        return json(res, 200, { ok: validation.ok, blocked: !validation.ok, validation, files, outputDir: outDir });
      }

      if (sub === '/distribute' && method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const merged: Settings = { ...settings, ...(body.settings ?? {}) };
        const validation = validateProject(project);
        if (!validation.ok) return json(res, 200, { ok: false, blocked: true, validation, files: [], targets: [] });
        const files = compileProject(project, merged, validation);
        const targets: { name: string; folder: string; dest: string; count: number; error?: string }[] = [];
        const base = merged.network.targetDir?.trim();
        for (const m of merged.network.machineFolders) {
          const dest = join(base, m.folder);
          try {
            if (!base) throw new Error('No network target directory configured');
            mkdirSync(dest, { recursive: true });
            for (const f of files) await fs.writeFile(join(dest, f.name), f.content, 'utf8');
            targets.push({ name: m.name, folder: m.folder, dest, count: files.length });
          } catch (e) {
            targets.push({ name: m.name, folder: m.folder, dest, count: 0, error: (e as Error).message });
          }
        }
        return json(res, 200, { ok: validation.ok, blocked: false, validation, files, targets });
      }

      // Cut Rite Optimization endpoints (Module A)
      if (sub === '/cutrite') {
        const cutrite = buildCutRiteReport(project);
        return json(res, 200, cutrite);
      }

      if (sub === '/cutrite.csv') {
        const cutrite = buildCutRiteReport(project);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeName(project.name)}-cutrite.csv"`,
        });
        return res.end(cutrite.csv);
      }

      if (sub === '/bom') {
        const bom = buildBom(project, settings);
        return json(res, 200, bom);
      }

      if (sub === '/bom.csv') {
        const bom = buildBom(project, settings);
        const csv = bomToCsv(bom);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName(project.name)}-bom.csv"` });
        return res.end(csv);
      }

      if (sub === '/labels') {
        const bom = buildBom(project, settings);
        return json(res, 200, buildLabels(project, bom));
      }

      const cixMatch = sub.match(/^\/cix\/(.+)$/);
      if (cixMatch) {
        const rawParam = decodeURIComponent(cixMatch[1]).replace(/\.cix$/i, '');
        const panel = project.cabinets
          .flatMap((c) => c.panels)
          .find((p) => p.partCode === rawParam || panelFileName(p) === `${rawParam}.cix` || p.id === rawParam);
        if (!panel) return json(res, 404, { error: 'Panel not found' });
        const content = compilePanel(panel, { settings });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${panelFileName(panel)}"` });
        return res.end(content);
      }
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown endpoint' });

    // -- Static --------------------------------------------------------------
    return serveStatic(res, pathname);
  } catch (e) {
    console.error('[server]', (e as Error).message);
    if (!res.headersSent) return json(res, 500, { error: (e as Error).message });
  }
}

function deriveProjectName(files: ImportFile[]): string {
  const parts = files[0]?.name.split(/[\\/]/).filter(Boolean) ?? [];
  return parts.length > 1 ? parts[0] : 'Imported batch';
}

function safeName(name: string): string {
  return (name || 'project').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'project';
}

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  void handle(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  system2 · Unified Woodworking Operations Engine`);
  console.log(`  → http://localhost:${PORT}\n`);
});
