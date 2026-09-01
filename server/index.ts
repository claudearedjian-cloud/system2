/**
 * system2 backend: static hosting + batch-processing API.
 *
 *   POST /api/import                ingest a batch of files
 *   GET  /api/projects              list projects
 *   GET  /api/projects/:id          project detail (includes placements)
 *   GET  /api/projects/:id/validation
 *   POST /api/projects/:id/compile  validate + generate .cix files
 *   POST /api/projects/:id/distribute  write .cix to the network target
 *   GET  /api/projects/:id/bom
 *   GET  /api/projects/:id/labels
 *   GET  /api/projects/:id/cix/:name
 *   GET/PUT /api/settings
 *   POST /api/import-folder         ingest from a server-side folder path
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Project, Settings } from '../shared/types.js';
import { importBatch, type ImportFile } from '../src/parse/index.js';
import { validateProject } from '../src/validate.js';
import { compileProject, compilePanel, panelFileName } from '../src/cix.js';
import { buildBom, buildLabels, bomToCsv } from '../src/reports.js';
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

function loadState() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) } as Settings;
    }
    if (existsSync(STATE_FILE)) {
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      for (const p of state.projects ?? []) projects.set(p.id, p);
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
      // Dev tool: never let the browser cache frontend assets, otherwise
      // operators keep seeing a stale UI after updates.
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
  const entries = await fs.readdir(resolved, { withFileTypes: true });
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
      projects.set(project.id, project);
      saveState();
      return json(res, 200, { projectId: project.id, project, unmatched });
    }

    if (pathname === '/api/load-sample' && method === 'POST') {
      const sampleDir = join(ROOT, 'sample-data', 'kitchen-demo');
      if (!existsSync(sampleDir)) return json(res, 400, { error: 'Sample data not found — run `npm run sample` first.' });
      const files = await importFolder(sampleDir);
      const { project, unmatched } = importBatch(files);
      project.name = 'Kitchen demo (sample)';
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
        const panelId = decodeURIComponent(cixMatch[1]).replace(/\.cix$/i, '');
        const panel = project.cabinets.flatMap((c) => c.panels).find((p) => panelFileName(p) === `${panelId}.cix` || p.id === panelId);
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
  console.log(`\n  system2 · Automated Cabinet Manufacturing OPS`);
  console.log(`  → http://localhost:${PORT}\n`);
});
