// system2 control panel — wires API, tree, viewers, validation, CIX, BOM,
// labels and settings together.
import { api, state, DRILL_COLORS, materialColor, fmt } from './api.js';
import { code128 } from './code128.js';
import { createViewer2D } from './viewer2d.js';
import { createViewer3D } from './viewer3d.js';

const $ = (sel) => document.querySelector(sel);

const el = {
  projectSelect: $('#projectSelect'),
  statsBar: $('#statsBar'),
  tree: $('#tree'),
  treeCount: $('#treeCount'),
  dropzone: $('#dropzone'),
  fileInput: $('#fileInput'),
  folderInput: $('#folderInput'),
  importStatus: $('#importStatus'),
  tabs: $('#tabs'),
  viewer2d: $('#viewer2d'),
  viewer3d: $('#viewer3d'),
  viewerEmpty: $('#viewerEmpty'),
  panelViewer: $('#panel-viewer'),
  panelValidation: $('#panel-validation'),
  panelCix: $('#panel-cix'),
  panelBom: $('#panel-bom'),
  inspectorBody: $('#inspectorBody'),
  statusbar: $('#statusbar'),
  viewModeSeg: $('#viewModeSeg'),
  chkShowDrills: $('#chkShowDrills'),
  chkShowGrooves: $('#chkShowGrooves'),
  chkShowBand: $('#chkShowBand'),
  btnFit: $('#btnFit'),
  btnImportFolder: $('#btnImportFolder'),
  btnLoadSample: $('#btnLoadSample'),
  btnSettings: $('#btnSettings'),
};

// Viewers are created defensively: on machines without WebGL (RDP, no GPU,
// hardware acceleration disabled) the constructor throws — we must NOT let that
// take down the whole UI.  Everything else keeps working without the viewer.
const NOOP_VIEWER = { setPanel() {}, setProject() {}, highlight() {}, resize() {}, dispose() {} };
const v2d = makeViewer(createViewer2D, el.viewer2d, '2D');
const v3d = makeViewer(createViewer3D, el.viewer3d, '3D');

function makeViewer(factory, container, label) {
  try {
    return factory(container);
  } catch (e) {
    reportError(`${label} viewer unavailable (WebGL may be disabled): ${e.message}`);
    return NOOP_VIEWER;
  }
}

function reportError(msg) {
  console.error('[system2]', msg);
  const b = document.getElementById('fatalBanner');
  if (b) {
    b.hidden = false;
    b.textContent = '⚠ ' + msg;
  }
}

function setStatus(msg, kind) {
  el.statusbar.innerHTML = `<span class="dot" style="background:${kind === 'error' ? 'var(--error)' : 'var(--ok)'}"></span>${msg}`;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function init() {
  bindEvents(); // attach click handlers FIRST so the UI is always responsive
  try {
    state.settings = await api('/api/settings');
    await refreshProjects();
    if (!state.projects.length) {
      setStatus('UI ready — click “▶ Load sample” to load the demo kitchen.');
    }
    window.__appReady = true;
  } catch (e) {
    setStatus(`Startup error: ${e.message}`, 'error');
    reportError(`Startup error: ${e.message}`);
  }
}

async function refreshProjects() {
  state.projects = await api('/api/projects');
  renderProjectSelect();
  if (state.projects.length && !state.project) {
    await openProject(state.projects[state.projects.length - 1].id);
  } else if (!state.projects.length) {
    el.viewerEmpty.classList.remove('hidden');
  }
}

function renderProjectSelect() {
  el.projectSelect.innerHTML = '';
  if (!state.projects.length) {
    const o = document.createElement('option');
    o.textContent = '— no projects —';
    el.projectSelect.appendChild(o);
    return;
  }
  for (const p of state.projects) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.name} (${p.stats.panels} parts)`;
    if (state.project && state.project.id === p.id) o.selected = true;
    el.projectSelect.appendChild(o);
  }
}

async function openProject(id) {
  state.project = await api(`/api/projects/${encodeURIComponent(id)}`);
  state.panelId = null;
  state.cabinetId = null;
  renderProjectSelect();
  renderStats();
  renderTree();
  renderInspector();
  el.viewerEmpty.classList.add('hidden');
  v2d.setPanel(null);
  v3d.setProject(state.project, {});
  setStatus(`Loaded “${state.project.name}” — ${state.project.stats.partInstances} part instances across ${state.project.stats.cabinets} cabinets.`);
}

function renderStats() {
  const s = state.project.stats;
  el.statsBar.innerHTML = `
    <span class="chip"><b>${s.cabinets}</b> cabinets</span>
    <span class="chip"><b>${s.panels}</b> parts</span>
    <span class="chip"><b>${s.partInstances}</b> instances</span>
    <span class="chip"><b>${s.thicknesses.join('/')}</b> mm</span>
  `;
}

// ---------------------------------------------------------------------------
// Project tree
// ---------------------------------------------------------------------------
function renderTree() {
  el.tree.innerHTML = '';
  el.treeCount.textContent = `${state.project.cabinets.length} cabinets`;
  const showAll = document.createElement('button');
  showAll.className = 'btn small ghost';
  showAll.textContent = '3D: full batch';
  showAll.style.cssText = 'margin-left:8px;';
  showAll.onclick = () => {
    state.cabinetId = null;
    v3d.setProject(state.project, { panelId: state.panelId });
    [...el.tree.querySelectorAll('.cab')].forEach((c) => c.classList.add('open'));
  };
  el.treeCount.after(showAll);

  for (const cab of state.project.cabinets) {
    const wrap = document.createElement('div');
    wrap.className = 'cab open';
    const row = document.createElement('div');
    row.className = 'row';
    const color = cab.panels[0] ? materialColor(cab.panels[0].material) : '#666';
    row.innerHTML = `<span class="arrow">▶</span><span class="dot" style="background:${color}"></span>${escapeHtml(cab.name)}<span class="count">${cab.panels.length}</span>`;
    row.onclick = () => {
      const open = wrap.classList.toggle('open');
      state.cabinetId = open ? cab.id : null;
      v3d.setProject(state.project, { cabinetId: state.cabinetId, panelId: state.panelId });
    };
    wrap.appendChild(row);

    const parts = document.createElement('div');
    parts.className = 'parts';
    for (const p of cab.panels) {
      const pr = document.createElement('div');
      pr.className = 'part';
      pr.dataset.panelId = p.id;
      pr.innerHTML = `<span class="dot" style="background:${materialColor(p.material)}"></span>${escapeHtml(p.name)}<span class="muted" style="margin-left:auto">${fmt(p.width)}×${fmt(p.height)}</span>`;
      pr.onclick = () => selectPanel(p.id);
      parts.appendChild(pr);
    }
    wrap.appendChild(parts);
    el.tree.appendChild(wrap);
  }

  if (state.panelId) {
    const active = el.tree.querySelector(`.part[data-panel-id="${cssEscape(state.panelId)}"]`);
    active?.classList.add('active');
  }
}

function selectPanel(panelId) {
  state.panelId = panelId;
  [...el.tree.querySelectorAll('.part')].forEach((p) => p.classList.toggle('active', p.dataset.panelId === panelId));
  const panel = state.project.cabinets.flatMap((c) => c.panels).find((p) => p.id === panelId);
  renderInspector();
  if (state.mode === '2d') refresh2d();
  v3d.highlight(panelId, true);
}

function refresh2d() {
  const panel = currentPanel();
  if (state.mode === '2d') {
    v2d.setPanel(panel, {
      showDrills: el.chkShowDrills.checked,
      showGrooves: el.chkShowGrooves.checked,
      showBand: el.chkShowBand.checked,
    });
  }
}

function currentPanel() {
  return state.project?.cabinets.flatMap((c) => c.panels).find((p) => p.id === state.panelId) ?? null;
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------
function renderInspector() {
  const panel = currentPanel();
  if (!panel) {
    el.inspectorBody.innerHTML = '<div class="empty-hint" style="position:static">Select a panel in the tree.</div>';
    return;
  }
  const drills = panel.drillings.map((d) => `
    <tr>
      <td><span class="badge ${d.face}">${d.face}</span></td>
      <td>Ø${fmt(d.diameter, 1)}mm · ${fmt(d.depth, 1)}mm deep<br/><span class="muted">(${fmt(d.x)}, ${fmt(d.y)})</span></td>
    </tr>`).join('');

  const grooves = (panel.grooves ?? []).map((g) => `
    <tr><td><span class="badge groove">route</span></td><td>${g.points.length} pts · ${fmt(g.width, 1)}mm · ${fmt(g.depth, 1)}mm deep</td></tr>`).join('');

  const band = (panel.edgeband ?? []).map((e) => `<span class="badge band">${e.edge}: ${escapeHtml(e.material)}</span>`).join(' ');

  const hw = (panel.hardware ?? []).map((h) => `
    <tr><td>${escapeHtml(h.kind)}</td><td>${h.face} (${fmt(h.x)}, ${fmt(h.y)})${h.depth ? ` · ${fmt(h.depth, 1)}mm` : ''}</td></tr>`).join('');

  el.inspectorBody.innerHTML = `
    <div class="part-title">${escapeHtml(panel.name)}</div>
    <div class="part-sub">${escapeHtml(panel.id)} · ${escapeHtml(panel.cabinetId)}</div>
    <table>
      <tr><td>Dimensions</td><td><b>${fmt(panel.width)} × ${fmt(panel.height)} × ${fmt(panel.thickness)}</b> mm</td></tr>
      <tr><td>Material</td><td>${escapeHtml(panel.material)}</td></tr>
      <tr><td>Panel type</td><td>${escapeHtml(panel.panelType)}</td></tr>
      <tr><td>Grain</td><td>${panel.grain}</td></tr>
      <tr><td>Qty</td><td>${panel.qty}</td></tr>
    </table>

    <h3>Drillings (${panel.drillings.length})</h3>
    ${drills ? `<table>${drills}</table>` : '<p class="muted">none</p>'}

    <h3>Toolpaths (${(panel.grooves ?? []).length})</h3>
    ${grooves ? `<table>${grooves}</table>` : '<p class="muted">none</p>'}

    <h3>Edge banding</h3>
    <div class="row" style="gap:4px">${band || '<span class="muted">none</span>'}</div>

    <h3>Hardware (${(panel.hardware ?? []).length})</h3>
    ${hw ? `<table>${hw}</table>` : '<p class="muted">none</p>'}

    ${panel.assemblyFlags?.length ? `<h3>Assembly flags</h3><div class="row" style="gap:4px">${panel.assemblyFlags.map((f) => `<span class="badge warn">${escapeHtml(f)}</span>`).join('')}</div>` : ''}

    <div style="margin-top:14px">
      <a class="btn small" href="/api/projects/${encodeURIComponent(state.project.id)}/cix/${encodeURIComponent(panel.id)}" download>⬇ Download .cix</a>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
function bindEvents() {
  el.projectSelect.onchange = () => {
    if (el.projectSelect.value) openProject(el.projectSelect.value);
  };

  el.tabs.querySelectorAll('button').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  el.viewModeSeg.querySelectorAll('button').forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode);
  });

  el.btnFit.onclick = () => {
    if (state.mode === '2d') refresh2d();
    else v3d.setProject(state.project, { cabinetId: state.cabinetId, panelId: state.panelId });
  };

  el.btnImportFolder.onclick = () => el.folderInput.click();
  el.btnLoadSample.onclick = loadSample;
  el.btnSettings.onclick = () => switchTab('settings');

  el.dropzone.onclick = () => el.fileInput.click();
  el.dropzone.ondragover = (e) => { e.preventDefault(); el.dropzone.classList.add('drag'); };
  el.dropzone.ondragleave = () => el.dropzone.classList.remove('drag');
  el.dropzone.ondrop = async (e) => {
    e.preventDefault();
    el.dropzone.classList.remove('drag');
    const files = [...e.dataTransfer.files];
    if (files.length) await importFiles(files);
  };

  el.fileInput.onchange = async () => {
    await importFiles([...el.fileInput.files]);
    el.fileInput.value = '';
  };
  el.folderInput.onchange = async () => {
    await importFiles([...el.folderInput.files], true);
    el.folderInput.value = '';
  };

  el.chkShowDrills.onchange = () => refresh2d();
  el.chkShowGrooves.onchange = () => refresh2d();
  el.chkShowBand.onchange = () => refresh2d();

  window.addEventListener('resize', () => {
    v2d.resize();
    v3d.resize();
  });
}

async function readFiles(files, useRelativePath) {
  const out = [];
  for (const f of files) {
    const content = await f.text();
    out.push({ name: useRelativePath ? (f.webkitRelativePath || f.name) : f.name, content });
  }
  return out;
}

async function importFiles(files, folderMode = false) {
  if (!files.length) return;
  el.importStatus.textContent = 'Parsing batch…';
  el.importStatus.className = 'import-status';
  try {
    const list = await readFiles(files, folderMode);
    let name = 'Imported batch';
    if (folderMode) {
      const rel = files[0].webkitRelativePath || files[0].name;
      const seg = rel.split('/')[0];
      if (seg && !/\.[a-z]+$/i.test(seg)) name = seg;
    } else {
      const d = new Date().toISOString().slice(0, 16).replace('T', ' ');
      name = `Imported ${d}`;
    }
    const result = await api('/api/import', {
      method: 'POST',
      body: JSON.stringify({ name, files: list }),
    });
    el.importStatus.textContent = `✔ Imported ${result.project.stats.panels} parts across ${result.project.stats.cabinets} cabinets.`;
    el.importStatus.className = 'import-status ok';
    await refreshProjects();
    await openProject(result.projectId);
    if (result.unmatched.length) {
      setStatus(`Note: ${result.unmatched.length} file(s) ignored: ${result.unmatched.join(', ')}`, 'error');
    }
  } catch (e) {
    el.importStatus.textContent = `✖ ${e.message}`;
    el.importStatus.className = 'import-status error';
  }
}

async function loadSample() {
  el.importStatus.textContent = 'Loading demo kitchen…';
  el.importStatus.className = 'import-status';
  try {
    const result = await api('/api/load-sample', { method: 'POST' });
    el.importStatus.textContent = `✔ Loaded demo project (${result.project.stats.panels} parts).`;
    el.importStatus.className = 'import-status ok';
    await refreshProjects();
    await openProject(result.projectId);
  } catch (e) {
    el.importStatus.textContent = `✖ ${e.message}`;
    el.importStatus.className = 'import-status error';
  }
}

// ---------------------------------------------------------------------------
// Tabs / modes
// ---------------------------------------------------------------------------
function switchTab(tab) {
  el.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const key of ['viewer', 'validation', 'cix', 'bom', 'settings']) {
    const panel = document.getElementById(`panel-${key}`);
    panel.classList.toggle('hidden', key !== tab);
  }
  if (tab === 'viewer') {
    // Re-fit after being hidden.
    requestAnimationFrame(() => {
      v2d.resize(); v3d.resize();
    });
  }
  if (tab === 'validation') renderValidation();
  if (tab === 'cix') renderCix();
  if (tab === 'bom') renderBom();
  if (tab === 'settings') renderSettings();
}

function setMode(mode) {
  state.mode = mode;
  el.viewModeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  el.viewer2d.classList.toggle('hidden', mode !== '2d');
  el.viewer3d.classList.toggle('hidden', mode !== '3d');
  if (mode === '2d') {
    refresh2d();
  } else {
    v3d.setProject(state.project, { cabinetId: state.cabinetId, panelId: state.panelId });
    requestAnimationFrame(() => v3d.resize());
  }
}

// ---------------------------------------------------------------------------
// Validation tab
// ---------------------------------------------------------------------------
async function renderValidation() {
  const host = el.panelValidation;
  if (!state.project) { host.innerHTML = '<div class="scroll"><p class="muted">No project loaded.</p></div>'; return; }
  host.innerHTML = '<div class="scroll"><p class="muted">Running pre-flight checks…</p></div>';
  const report = await api(`/api/projects/${encodeURIComponent(state.project.id)}/validation`);
  const errors = report.issues.filter((i) => i.severity === 'error');
  const warnings = report.issues.filter((i) => i.severity === 'warning');

  const rows = report.issues.length
    ? report.issues.map((i) => `
        <tr>
          <td><span class="badge ${i.severity}">${i.severity}</span></td>
          <td class="mono">${escapeHtml(i.code)}</td>
          <td class="mono">${escapeHtml(i.panelId)}</td>
          <td>${escapeHtml(i.message)}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="muted">No issues found — batch is clean.</td></tr>';

  host.innerHTML = `
    <div class="scroll">
      <div class="summary-row">
        <div class="kpi"><div class="k">Status</div><div class="v ${report.ok ? 'good' : 'bad'}">${report.ok ? 'PASS' : 'BLOCKED'}</div></div>
        <div class="kpi"><div class="k">Errors</div><div class="v ${errors.length ? 'bad' : 'good'}">${errors.length}</div></div>
        <div class="kpi"><div class="k">Warnings</div><div class="v ${warnings.length ? 'warn' : 'good'}">${warnings.length}</div></div>
      </div>
      <div class="card">
        <div class="section-head"><h2>Issue list</h2><span class="chip">${report.issues.length}</span></div>
        <table class="data-table">
          <thead><tr><th>Level</th><th>Code</th><th>Part</th><th>Message</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${report.ok ? '' : '<div class="card" style="border-color:var(--error)"><b>Compilation blocked.</b> Resolve the errors above before writing .cix code.</div>'}
    </div>`;
}

// ---------------------------------------------------------------------------
// CIX tab
// ---------------------------------------------------------------------------
async function renderCix() {
  const host = el.panelCix;
  if (!state.project) { host.innerHTML = '<div class="scroll"><p class="muted">No project loaded.</p></div>'; return; }
  host.innerHTML = '<div class="scroll"><p class="muted">Compiling native .cix programs…</p></div>';
  const result = await api(`/api/projects/${encodeURIComponent(state.project.id)}/compile`, {
    method: 'POST',
    body: JSON.stringify({ settings: state.settings }),
  });

  const files = result.files ?? [];
  const fileRows = files.map((f, i) => `
    <tr>
      <td class="mono">${escapeHtml(f.name)}</td>
      <td>${f.size} B</td>
      <td>
        <a class="link" href="/api/projects/${encodeURIComponent(state.project.id)}/cix/${encodeURIComponent(f.name)}" download>download</a>
        · <a class="link" href="#" data-preview="${i}">view</a>
      </td>
    </tr>`).join('');

  const preview = files[0] ? highlightCix(files[0].content) : '';

  host.innerHTML = `
    <div class="scroll">
      <div class="summary-row">
        <div class="kpi"><div class="k">Status</div><div class="v ${result.ok ? 'good' : 'bad'}">${result.blocked ? 'BLOCKED' : result.ok ? 'OK' : 'FAIL'}</div></div>
        <div class="kpi"><div class="k">.cix files</div><div class="v">${files.length}</div></div>
        <div class="kpi"><div class="k">Output dir</div><div class="v" style="font-size:12px;word-break:break-all">${escapeHtml(result.outputDir || '—')}</div></div>
      </div>

      ${result.blocked ? '<div class="card" style="border-color:var(--error)">Compilation blocked by validation errors — see the Pre-flight tab.</div>' : ''}

      <div class="card">
        <div class="section-head">
          <h2>Native .cix programs</h2>
          <button class="btn small" id="btnDistribute">⇄ Distribute to network</button>
        </div>
        ${files.length ? `<table class="data-table"><thead><tr><th>File</th><th>Size</th><th></th></tr></thead><tbody>${fileRows}</tbody></table>` : '<p class="muted">No files generated.</p>'}
        <div id="distributeResult"></div>
      </div>

      ${preview ? `<div class="card"><div class="section-head"><h2>Preview</h2><span id="previewName" class="chip">${escapeHtml(files[0].name)}</span></div><pre class="code-block" id="cixPreview">${preview}</pre></div>` : ''}
    </div>`;

  const distBtn = host.querySelector('#btnDistribute');
  distBtn.onclick = distribute;

  host.querySelectorAll('a[data-preview]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      const i = Number(a.dataset.preview);
      host.querySelector('#cixPreview').innerHTML = highlightCix(files[i].content);
      host.querySelector('#previewName').textContent = files[i].name;
    };
  });
}

function highlightCix(content) {
  return escapeHtml(content)
    .split('\n')
    .map((l) => (l.trimStart().startsWith(';') ? `<span class="comment">${l}</span>` : l))
    .join('\n');
}

async function distribute() {
  const host = el.panelCix.querySelector('#distributeResult');
  host.innerHTML = '<p class="muted">Writing .cix files to configured network targets…</p>';
  const result = await api(`/api/projects/${encodeURIComponent(state.project.id)}/distribute`, {
    method: 'POST',
    body: JSON.stringify({ settings: state.settings }),
  });
  if (!result.ok) {
    host.innerHTML = '<p style="color:var(--error)">Distribution blocked by validation errors.</p>';
    return;
  }
  const rows = result.targets.map((t) => `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td class="mono">${escapeHtml(t.dest || '—')}</td>
      <td>${t.error ? `<span class="badge error">failed: ${escapeHtml(t.error)}</span>` : `<span class="badge ok">${t.count} files written</span>`}</td>
    </tr>`).join('');
  host.innerHTML = `
    <h3 style="margin-top:14px">Network distribution</h3>
    <table class="data-table"><thead><tr><th>Target</th><th>Path</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">Configure target folders in Settings. For SMB shares, mount them locally and point targetDir at the mount path.</p>`;
}

// ---------------------------------------------------------------------------
// BOM + Labels tab
// ---------------------------------------------------------------------------
async function renderBom() {
  const host = el.panelBom;
  if (!state.project) { host.innerHTML = '<div class="scroll"><p class="muted">No project loaded.</p></div>'; return; }
  host.innerHTML = '<div class="scroll"><p class="muted">Building BOM and labels…</p></div>';

  const bom = await api(`/api/projects/${encodeURIComponent(state.project.id)}/bom`);
  const labels = await api(`/api/projects/${encodeURIComponent(state.project.id)}/labels`);

  const matRows = bom.materials.map((m) => `
    <tr>
      <td>${escapeHtml(m.material)}</td>
      <td>${m.thickness}</td>
      <td>${m.partCount}</td>
      <td>${m.instanceCount}</td>
      <td>${fmt(m.areaM2, 2)} m²</td>
      <td>~${m.estimatedBoards} × ${m.boardSize[0]}×${m.boardSize[1]}</td>
      <td>${fmt(m.cost, 2)} ${bom.currency}</td>
    </tr>`).join('');

  const lineRows = bom.lines.map((l) => `
    <tr>
      <td class="mono">${escapeHtml(l.partId)}</td>
      <td>${escapeHtml(l.name)}</td>
      <td>${escapeHtml(l.cabinet)}</td>
      <td>${escapeHtml(l.material)}</td>
      <td>${fmt(l.width)}×${fmt(l.height)}×${l.thickness}</td>
      <td>${l.qty}</td>
      <td>${escapeHtml(l.edgeband || '—')}</td>
    </tr>`).join('');

  const labelCards = labels.map((lb) => {
    let barcodeSvg = '';
    try { barcodeSvg = code128(lb.barcode); } catch { barcodeSvg = '<span class="muted">invalid barcode</span>'; }
    return `
      <div class="label-card">
        <div class="lc-top"><span>${escapeHtml(lb.name)}</span><span>${escapeHtml(lb.partId)}</span></div>
        <div class="lc-meta">
          <b>Proj</b><span>${escapeHtml(lb.project)}</span>
          <b>Cab</b><span>${escapeHtml(lb.cabinet)}</span>
          <b>Mat</b><span>${escapeHtml(lb.material)}</span>
          <b>Size</b><span>${fmt(lb.width)}×${fmt(lb.height)}×${lb.thickness} mm</span>
          <b>Edge</b><span>${escapeHtml(lb.edgeband || '—')}</span>
          <b>Ops</b><span>${escapeHtml(lb.secondaryOps.join(', ') || '—')}</span>
          <b>Qty</b><span>${lb.qty}</span>
        </div>
        <div class="lc-barcode">${barcodeSvg}</div>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div class="scroll">
      <div class="summary-row">
        <div class="kpi"><div class="k">Parts</div><div class="v">${bom.lines.length}</div></div>
        <div class="kpi"><div class="k">Edge banding</div><div class="v">${fmt(bom.edgebandMeters, 1)} m</div></div>
        <div class="kpi"><div class="k">Est. cost</div><div class="v">${fmt(bom.totalCost, 0)} ${bom.currency}</div></div>
      </div>

      <div class="card">
        <div class="section-head">
          <h2>Material summary</h2>
          <a class="btn small ghost" href="/api/projects/${encodeURIComponent(state.project.id)}/bom.csv" download>⬇ BOM CSV</a>
        </div>
        <table class="data-table">
          <thead><tr><th>Material</th><th>T</th><th>Parts</th><th>Instances</th><th>Area</th><th>Boards</th><th>Cost</th></tr></thead>
          <tbody>${matRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="section-head"><h2>Cutting list</h2></div>
        <table class="data-table">
          <thead><tr><th>Part</th><th>Name</th><th>Cabinet</th><th>Material</th><th>Size</th><th>Qty</th><th>Edgeband</th></tr></thead>
          <tbody>${lineRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="section-head">
          <h2>Part labels (barcode)</h2>
          <button class="btn small" id="btnPrintLabels">🖨 Print labels</button>
        </div>
        <div class="labels-grid">${labelCards}</div>
      </div>
    </div>`;

  host.querySelector('#btnPrintLabels').onclick = () => printLabels(labels);
}

function printLabels(labels) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { alert('Please allow pop-ups to print labels.'); return; }
  const cards = labels.map((lb) => {
    let barcodeSvg = '';
    try { barcodeSvg = code128(lb.barcode); } catch {}
    return `
      <div class="label-card">
        <div class="lc-top"><span>${escapeHtml(lb.name)}</span><span>${escapeHtml(lb.partId)}</span></div>
        <div class="lc-meta">
          <b>Proj</b><span>${escapeHtml(lb.project)}</span>
          <b>Cab</b><span>${escapeHtml(lb.cabinet)}</span>
          <b>Mat</b><span>${escapeHtml(lb.material)}</span>
          <b>Size</b><span>${fmt(lb.width)}×${fmt(lb.height)}×${lb.thickness} mm</span>
          <b>Edge</b><span>${escapeHtml(lb.edgeband || '—')}</span>
          <b>Ops</b><span>${escapeHtml(lb.secondaryOps.join(', ') || '—')}</span>
          <b>Qty</b><span>${lb.qty}</span>
        </div>
        <div class="lc-barcode">${barcodeSvg}</div>
      </div>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><title>Part labels</title>
    <style>
      body { font-family: system-ui; margin: 0; padding: 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      .label-card { border: 1px solid #ccc; border-radius: 8px; padding: 10px; font-size: 11px; color: #111; }
      .lc-top { display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; }
      .lc-meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; color: #333; }
      .lc-barcode { margin: 8px 0 4px; text-align: center; }
      .lc-barcode svg { width: 100%; height: 46px; }
      @media print { body { grid-template-columns: repeat(3, 1fr); } }
    </style></head><body>${cards}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------
async function renderSettings() {
  const host = document.getElementById('panel-settings');
  if (!host) return;
  const s = state.settings;
  const folders = s.network.machineFolders.map((m, i) => `
    <div class="row">
      <input type="text" data-k="machineName" data-i="${i}" value="${escapeAttr(m.name)}" style="flex:0 0 140px" />
      <input type="text" data-k="machineFolder" data-i="${i}" value="${escapeAttr(m.folder)}" style="flex:1" />
      <button class="btn small ghost" data-k="delMachine" data-i="${i}">✕</button>
    </div>`).join('');

  host.innerHTML = `
    <div class="scroll">
      <div class="card">
        <div class="section-head"><h2>Network distribution (SMB / LAN)</h2></div>
        <div class="form-grid">
          <div class="field"><label>Protocol</label>
            <select data-k="netProtocol">
              <option value="local" ${s.network.protocol === 'local' ? 'selected' : ''}>Local path (mounted share)</option>
              <option value="smb" ${s.network.protocol === 'smb' ? 'selected' : ''}>SMB</option>
            </select>
          </div>
          <div class="field" style="grid-column: span 2"><label>Target directory (absolute path or mounted SMB share)</label>
            <input type="text" data-k="netTarget" value="${escapeAttr(s.network.targetDir)}" placeholder="/mnt/workshop or \\\\nas\\bSolid" />
          </div>
        </div>
        <h3 style="margin:14px 0 6px">Machine folders</h3>
        ${folders}
        <button class="btn small ghost" data-k="addMachine" style="margin-top:8px">+ Add machine</button>
        <p class="muted" style="margin-top:12px">Each machine folder receives a full copy of the compiled .cix batch. On Windows, mount the NAS/SMB share and point the target at the drive letter (e.g. <span class="mono">Z:\\</span>).</p>
      </div>

      <div class="card">
        <div class="section-head"><h2>Biesse tooling</h2></div>
        <div class="form-grid">
          <div class="field"><label>Main router diameter (mm)</label><input type="number" data-k="routerDia" value="${s.tooling.routerDiameter}" /></div>
        </div>
        <table class="data-table" style="margin-top:10px">
          <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Ø mm</th><th>Spindle</th></tr></thead>
          <tbody>${s.tooling.tools.map((t) => `<tr><td class="mono">${escapeHtml(t.id)}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.type)}</td><td>${t.diameter}</td><td>${t.spindle ?? '—'}</td></tr>`).join('')}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="section-head"><h2>Costing</h2></div>
        <div class="form-grid">
          <div class="field"><label>Currency</label><input type="text" data-k="currency" value="${escapeAttr(s.costs.currency)}" /></div>
          <div class="field"><label>Sheet size W×L (mm)</label><input type="text" data-k="boardSize" value="${s.costs.boardSize.join('x')}" /></div>
          <div class="field"><label>Waste %</label><input type="number" data-k="waste" value="${s.costs.wastePercent}" /></div>
          <div class="field"><label>Edge banding / m</label><input type="number" data-k="bandCost" value="${s.costs.edgebandPerMeter}" /></div>
        </div>
      </div>

      <div class="row">
        <button class="btn" data-k="save">Save settings</button>
        <span id="settingsMsg" class="muted"></span>
      </div>
    </div>`;

  host.querySelector('[data-k=save]').onclick = saveSettings;
  host.querySelector('[data-k=addMachine]').onclick = () => {
    s.network.machineFolders.push({ name: 'New machine', folder: 'new-folder' });
    renderSettings();
  };
  host.querySelectorAll('[data-k=delMachine]').forEach((b) => {
    b.onclick = () => { s.network.machineFolders.splice(Number(b.dataset.i), 1); renderSettings(); };
  });
}

async function saveSettings() {
  const host = document.getElementById('panel-settings');
  const s = state.settings;
  const get = (k) => host.querySelector(`[data-k="${k}"]`);

  s.network.protocol = get('netProtocol').value;
  s.network.targetDir = get('netTarget').value.trim();
  s.tooling.routerDiameter = parseFloat(get('routerDia').value) || 12;
  s.costs.currency = get('currency').value || 'USD';
  const [bw, bh] = (get('boardSize').value || '2800x2070').split(/[x×]/).map((n) => parseFloat(n) || 0);
  if (bw && bh) s.costs.boardSize = [bw, bh];
  s.costs.wastePercent = parseFloat(get('waste').value) || 15;
  s.costs.edgebandPerMeter = parseFloat(get('bandCost').value) || 0.9;

  host.querySelectorAll('[data-k=machineName]').forEach((inp) => {
    const i = Number(inp.dataset.i);
    s.network.machineFolders[i].name = inp.value.trim();
  });
  host.querySelectorAll('[data-k=machineFolder]').forEach((inp) => {
    const i = Number(inp.dataset.i);
    s.network.machineFolders[i].folder = inp.value.trim();
  });

  state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
  const msg = host.querySelector('#settingsMsg');
  msg.textContent = '✔ Saved.';
  msg.className = 'muted';
  setTimeout(() => { msg.textContent = ''; }, 2500);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

init().catch((e) => {
  console.error(e);
  reportError('Initialization failed: ' + (e && e.message ? e.message : e));
});
