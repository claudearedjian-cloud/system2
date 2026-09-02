// system2 — Woodworking Operations Engine (Polyboard -> Cut Rite / bSolid Pipeline)
// Controls Station Modes, Global Barcode Scanning, 3D Active Part Highlighting,
// Cabinet Assembly Checklist, Hardware Graphics, CNC Setup, and Cut Rite CSV.

import { api, state, materialColor, DRILL_COLORS, fmt } from './api.js';
import { code128 } from './code128.js';
import { createViewer2D } from './viewer2d.js';
import { initBarcodeListener } from './barcode.js';
import { playSuccessChime, playStageChime, playErrorBeep } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// DOM Elements with safe fallbacks
const el = {
  // Topbar
  stationNav: $('#stationNav'),
  projectSelect: $('#projectSelect'),
  barcodeManualInput: $('#barcodeManualInput'),
  btnManualScan: $('#btnManualScan'),
  quickScanPills: $('#quickScanPills'),
  btnLoadSample: $('#btnLoadSample'),
  btnAudioToggle: $('#btnAudioToggle'),
  btnSettings: $('#btnSettings'),
  scanToast: $('#scanToast'),
  toastTitle: $('#toastTitle'),
  toastMessage: $('#toastMessage'),
  toastClose: $('#toastClose'),
  statusbar: $('#statusbar'),
  statusText: $('#statusText'),

  // Station Views
  views: {
    assembly: $('#view-assembly'),
    cnc: $('#view-cnc'),
    saw: $('#view-saw'),
    cam: $('#view-cam'),
  },

  // Assembly Zone Elements
  assemblyCabBadge: $('#assemblyCabBadge'),
  assemblyCabinetSelect: $('#assemblyCabinetSelect'),
  assemblyProgressLabel: $('#assemblyProgressLabel'),
  assemblyStatusTag: $('#assemblyStatusTag'),
  assemblyProgressBar: $('#assemblyProgressBar'),
  assemblyPartsList: $('#assemblyPartsList'),
  btnResetBatchStatus: $('#btnResetBatchStatus'),
  btnMarkCabAssembled: $('#btnMarkCabAssembled'),
  btn3dReset: $('#btn3dReset'),
  btn3dFullBatch: $('#btn3dFullBatch'),
  sliderExplode: $('#sliderExplode'),
  explodeVal: $('#explodeVal'),
  chkGhostMode: $('#chkGhostMode'),
  assembly3dHost: $('#assembly3dHost'),
  viewer3dAssembly: $('#viewer3dAssembly'),
  assemblyActiveBanner: $('#assemblyActiveBanner'),
  activePartName: $('#activePartName'),
  assemblyEmptyHint: $('#assemblyEmptyHint'),
  hwPartCodeBadge: $('#hwPartCodeBadge'),
  hwPanelSubtitle: $('#hwPanelSubtitle'),
  specPartTitle: $('#specPartTitle'),
  specDim: $('#specDim'),
  specMat: $('#specMat'),
  specGrain: $('#specGrain'),
  specStatus: $('#specStatus'),
  specEdgeband: $('#specEdgeband'),
  hwCountBadge: $('#hwCountBadge'),
  hardwareCardsList: $('#hardwareCardsList'),
  btnToggleStageCurrent: $('#btnToggleStageCurrent'),

  // CNC Station Elements
  cncPartQueue: $('#cncPartQueue'),
  cncActivePartTitle: $('#cncActivePartTitle'),
  btnDistributeLan: $('#btnDistributeLan'),
  btnMarkCncComplete: $('#btnMarkCncComplete'),
  viewer2dCnc: $('#viewer2dCnc'),
  cncNetMsg: $('#cncNetMsg'),
  cixCodePreview: $('#cixCodePreview'),
  btnDownloadCix: $('#btnDownloadCix'),

  // Saw / Cut Rite Station Elements
  btnDownloadCutRiteCsv: $('#btnDownloadCutRiteCsv'),
  btnPrintLabelsFromSaw: $('#btnPrintLabelsFromSaw'),
  syncStatText: $('#syncStatText'),
  cutRitePartCount: $('#cutRitePartCount'),
  cutRiteTableBody: $('#cutRiteTableBody'),
  sawLabelsGrid: $('#sawLabelsGrid'),
  btnPrintAllLabels: $('#btnPrintAllLabels'),

  // CAM & Pre-flight Elements
  camTabs: $$('.cam-tab'),
  camPanels: {
    import: $('#campanel-import'),
    preflight: $('#campanel-preflight'),
    cad2d: $('#campanel-cad2d'),
    settings: $('#campanel-settings'),
  },
  dropzoneMain: $('#dropzoneMain'),
  fileInputMain: $('#fileInputMain'),
  folderInputMain: $('#folderInputMain'),
  btnLoadSampleCam: $('#btnLoadSampleCam'),
  camImportStatus: $('#camImportStatus'),
  btnRevalidate: $('#btnRevalidate'),
  preflightSummary: $('#preflightSummary'),
  preflightIssues: $('#preflightIssues'),
  viewer2dCam: $('#viewer2dCam'),
  chkCadDrills: $('#chkCadDrills'),
  chkCadGrooves: $('#chkCadGrooves'),
  chkCadBand: $('#chkCadBand'),
  chkCadOrigins: $('#chkCadOrigins'),
  cfgProtocol: $('#cfgProtocol'),
  cfgTargetDir: $('#cfgTargetDir'),
  cfgMachineFoldersList: $('#cfgMachineFoldersList'),
  btnAddMachineFolder: $('#btnAddMachineFolder'),
  cfgToolingTableBody: $('#cfgToolingTableBody'),
  btnSaveWorkshopSettings: $('#btnSaveWorkshopSettings'),
  settingsSaveMsg: $('#settingsSaveMsg'),
};

// Safe NOOP 3D Viewer fallback if WebGL fails in VM
const NOOP_VIEWER_3D = {
  setProject() {},
  highlight() {},
  setExplode() {},
  setGhostMode() {},
  resetView() {},
  setPanelCallback() {},
  resize() {},
  dispose() {},
  render() {},
};

let v3dAssembly = null;
let v3dLoading = null;
let v3dFailed = false;

let v2dCnc = null;
let v2dCam = null;
let activeStation = 'assembly';
let soundEnabled = true;
let barcodeScanner = null;
let activePanel = null;
let activeCabinet = null;

/**
 * Lazily and safely load the 3D WebGL Viewer so GPU issues or missing
 * WebGL acceleration in VMware can NEVER crash or freeze the app.
 */
function getV3d() {
  if (v3dAssembly) return Promise.resolve(v3dAssembly);
  if (v3dFailed) return Promise.resolve(NOOP_VIEWER_3D);
  if (!v3dLoading) {
    v3dLoading = import('./viewer3d.js')
      .then((m) => {
        if (el.viewer3dAssembly) {
          v3dAssembly = m.createViewer3D(el.viewer3dAssembly, {
            onPanelSelect: (panelId) => {
              selectPanelById(panelId, 'assembly');
            },
          });
        }
        return v3dAssembly || NOOP_VIEWER_3D;
      })
      .catch((e) => {
        v3dFailed = true;
        console.warn('[3D Viewer]', 'WebGL 3D Viewer unavailable in this environment:', e.message);
        if (el.viewer3dAssembly) {
          el.viewer3dAssembly.innerHTML = `
            <div class="empty-hint" style="color:var(--text-dim); padding:20px; text-align:center;">
              <div style="font-size:30px; margin-bottom:8px">🖥️</div>
              <div style="font-weight:700; color:var(--text); margin-bottom:4px">3D Graphics Acceleration Disabled</div>
              <div style="font-size:12px; max-width:340px; margin:0 auto; line-height:1.4">
                3D WebGL is inactive in this virtual machine. The 2D CAD viewer, CNC Station, Cut Rite saw, and Assembly checklist remain fully interactive.
              </div>
            </div>
          `;
        }
        return NOOP_VIEWER_3D;
      });
  }
  return v3dLoading;
}

// ---------------------------------------------------------------------------
// Bootstrap & Initialization
// ---------------------------------------------------------------------------
async function init() {
  // Bind UI Events FIRST so all buttons and clicks are immediately responsive!
  try {
    bindUIEvents();
  } catch (err) {
    console.error('[bindUIEvents failed]', err);
  }

  // Initialize 2D Viewers (Canvas 2D is 100% safe in all environments)
  try {
    if (el.viewer2dCnc) v2dCnc = createViewer2D(el.viewer2dCnc);
    if (el.viewer2dCam) v2dCam = createViewer2D(el.viewer2dCam);
  } catch (e) {
    console.warn('[v2d init error]', e);
  }

  // Eagerly trigger 3D initialization in background
  getV3d().catch(() => {});

  // Initialize Global Hardware Barcode Scanner Listener
  try {
    barcodeScanner = initBarcodeListener((barcode, source) => {
      handleBarcodeScan(barcode, activeStation);
    });
  } catch (e) {
    console.warn('[barcode init error]', e);
  }

  // Load Settings & Projects
  try {
    state.settings = await api('/api/settings');
    await refreshProjects();

    if (!state.projects.length) {
      await loadDemoKitchen();
    }
  } catch (e) {
    setStatus(`Startup note: ${e.message}`, 'error');
  }

  window.addEventListener('resize', () => {
    getV3d().then((v) => v.resize());
    if (v2dCnc) v2dCnc.resize();
    if (v2dCam) v2dCam.resize();
  });

  window.__appReady = true;
  setStatus('System ready — Barcode scanner listener active.', 'ok');
}

// ---------------------------------------------------------------------------
// Project & Data Loading
// ---------------------------------------------------------------------------
async function refreshProjects() {
  try {
    state.projects = await api('/api/projects');
    renderProjectPicker();

    if (state.projects.length && !state.project) {
      await openProject(state.projects[state.projects.length - 1].id);
    } else if (!state.projects.length) {
      if (el.assemblyEmptyHint) el.assemblyEmptyHint.classList.remove('hidden');
    }
  } catch (err) {
    console.error('[refreshProjects error]', err);
  }
}

function renderProjectPicker() {
  if (!el.projectSelect) return;
  el.projectSelect.innerHTML = '';
  if (!state.projects.length) {
    const o = document.createElement('option');
    o.textContent = '— No Projects —';
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
  try {
    state.project = await api(`/api/projects/${encodeURIComponent(id)}`);
    if (el.assemblyEmptyHint) el.assemblyEmptyHint.classList.add('hidden');

    if (state.project.cabinets.length > 0) {
      activeCabinet = state.project.cabinets[0];
      if (activeCabinet.panels.length > 0) {
        activePanel = activeCabinet.panels[0];
      }
    }

    renderCabinetSelector();
    renderAssemblyStation();
    renderCncStation();
    renderSawStation();
    renderCamStation();
    renderQuickScanPills();

    getV3d().then((v3d) => {
      if (v3d && state.project) {
        v3d.setProject(state.project, {
          cabinetId: activeCabinet ? activeCabinet.id : undefined,
          panelId: activePanel ? activePanel.id : undefined,
        });
      }
    });

    setStatus(`Loaded project: "${state.project.name}" (${state.project.stats.partInstances} parts).`, 'ok');
  } catch (err) {
    console.error('[openProject error]', err);
  }
}

async function loadDemoKitchen() {
  try {
    setStatus('Loading demo kitchen export…');
    const result = await api('/api/load-sample', { method: 'POST' });
    await refreshProjects();
    await openProject(result.projectId);
    showScanToast('Loaded Kitchen Demo', '15 parts across 2 cabinets ready for tracking.', 'ok');
  } catch (e) {
    setStatus(`Sample load error: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Barcode Scanning & Hardware Event Handler (Module C & D)
// ---------------------------------------------------------------------------
async function handleBarcodeScan(rawBarcode, station = activeStation) {
  const barcode = String(rawBarcode || '').trim();
  if (!barcode) return;

  setStatus(`Processing scan: [${barcode}]…`);

  try {
    const result = await api('/api/scan', {
      method: 'POST',
      body: JSON.stringify({
        barcode,
        station: activeStation,
        projectId: state.project ? state.project.id : undefined,
      }),
    });

    if (result.found && result.panel && result.cabinet) {
      state.project = await api(`/api/projects/${encodeURIComponent(result.projectId)}`);
      activeCabinet = state.project.cabinets.find((c) => c.id === result.cabinetId) || result.cabinet;
      activePanel = activeCabinet.panels.find((p) => p.id === result.panelId) || result.panel;

      if (soundEnabled) {
        if (result.cabinetStats && result.cabinetStats.percentComplete === 100) {
          playStageChime();
        } else {
          playSuccessChime();
        }
      }

      showScanToast(
        `Scanned: ${activePanel.name} [${activePanel.partCode}]`,
        `Marked as ${result.newStatus.toUpperCase().replace('_', ' ')} · ${result.cabinetStats.percentComplete}% Cabinet Complete`,
        'ok',
      );

      renderCabinetSelector();
      renderAssemblyStation();
      renderCncStation();
      renderSawStation();

      getV3d().then((v3d) => {
        v3d.setProject(state.project, {
          cabinetId: activeCabinet.id,
          panelId: activePanel.id,
        });
        v3d.highlight(activePanel.id, true);
      });

      if (v2dCnc) {
        v2dCnc.setPanel(activePanel);
      }

      setStatus(`✔ Scanned ${activePanel.partCode} (${activePanel.name}) — ${result.newStatus.toUpperCase()}`, 'ok');
    }
  } catch (e) {
    if (soundEnabled) playErrorBeep();
    showScanToast('Barcode Not Found', `No matching part for "${barcode}" in database.`, 'error');
    setStatus(`Barcode "${barcode}" not found.`, 'error');
  }
}

function showScanToast(title, message, kind = 'ok') {
  if (!el.scanToast) return;
  if (el.toastTitle) el.toastTitle.textContent = title;
  if (el.toastMessage) el.toastMessage.textContent = message;
  el.scanToast.classList.remove('hidden');
  el.scanToast.style.borderColor = kind === 'error' ? 'var(--error)' : 'var(--emerald)';

  setTimeout(() => {
    if (el.scanToast) el.scanToast.classList.add('hidden');
  }, 4000);
}

function renderQuickScanPills() {
  if (!el.quickScanPills) return;
  el.quickScanPills.innerHTML = '';
  if (!state.project) return;

  const sampleParts = state.project.cabinets.flatMap((c) => c.panels).slice(0, 5);
  for (const p of sampleParts) {
    const btn = document.createElement('button');
    btn.className = 'quick-scan-pill';
    btn.textContent = p.partCode || p.id.split('-').pop();
    btn.title = `Simulate scan of ${p.name} (${p.partCode})`;
    btn.onclick = () => handleBarcodeScan(p.barcode || p.partCode, activeStation);
    el.quickScanPills.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// Module D: Assembly Zone UI & Component Highlighter
// ---------------------------------------------------------------------------
function renderCabinetSelector() {
  if (!el.assemblyCabinetSelect) return;
  el.assemblyCabinetSelect.innerHTML = '';
  if (!state.project) return;

  for (const cab of state.project.cabinets) {
    const opt = document.createElement('option');
    opt.value = cab.id;
    opt.textContent = `${cab.name} (${cab.panels.length} parts)`;
    if (activeCabinet && activeCabinet.id === cab.id) opt.selected = true;
    el.assemblyCabinetSelect.appendChild(opt);
  }
}

function renderAssemblyStation() {
  if (!state.project || !activeCabinet) return;

  if (el.assemblyCabBadge) el.assemblyCabBadge.textContent = activeCabinet.name;

  const total = activeCabinet.panels.length;
  let stagedCount = 0;
  let assembledCount = 0;

  for (const p of activeCabinet.panels) {
    if (p.status === 'staged') stagedCount++;
    if (p.status === 'assembled') assembledCount++;
  }

  const doneCount = stagedCount + assembledCount;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  if (el.assemblyProgressBar) el.assemblyProgressBar.style.width = `${percent}%`;
  if (el.assemblyProgressLabel) el.assemblyProgressLabel.textContent = `Assembly Ready: ${doneCount} / ${total} Parts (${percent}%)`;
  if (el.assemblyStatusTag) {
    el.assemblyStatusTag.textContent = percent === 100 ? '✔ Assembled' : percent > 0 ? 'In Progress' : 'Pending Staging';
    el.assemblyStatusTag.className = percent === 100 ? 'chip ok' : 'chip';
  }

  if (el.assemblyPartsList) {
    el.assemblyPartsList.innerHTML = '';
    for (const p of activeCabinet.panels) {
      const isTarget = activePanel && activePanel.id === p.id;
      const isStaged = p.status === 'staged' || p.status === 'assembled';

      const card = document.createElement('div');
      card.className = `part-card ${isTarget ? 'active' : ''} ${p.status}`;
      card.dataset.panelId = p.id;

      const edgeStr = (p.edgeband || []).map((e) => `${e.edge}:${e.material.split(' ')[0]}`).join(' · ');
      const statusLabel = p.status.replace('_', ' ').toUpperCase();

      card.innerHTML = `
        <div class="part-card-top">
          <div class="part-name-block">
            <span class="part-check-icon">${isStaged ? '✔' : '○'}</span>
            <span class="part-title-text">${escapeHtml(p.name)}</span>
          </div>
          <span class="badge ${p.status === 'staged' ? 'ok' : p.status === 'assembled' ? 'info' : 'pending'}">${statusLabel}</span>
        </div>
        <div class="part-card-meta">
          <span class="part-code-tag">${escapeHtml(p.partCode || p.id)}</span>
          <span>${fmt(p.width)} × ${fmt(p.height)} × ${p.thickness} mm</span>
        </div>
        ${edgeStr ? `<div class="part-edge-summary muted">Edge: ${escapeHtml(edgeStr)}</div>` : ''}
        <div class="part-card-actions">
          <span class="muted" style="font-size:10px">${p.hardware?.length || 0} hardware fittings</span>
          <button class="btn-stage-toggle ${isStaged ? 'is-staged' : ''}" data-action="toggle-stage">
            ${p.status === 'assembled' ? '✔ Assembled' : p.status === 'staged' ? '✔ Staged' : 'Mark Staged'}
          </button>
        </div>
      `;

      card.onclick = (e) => {
        const btn = e.target.closest('[data-action=toggle-stage]');
        if (btn) {
          e.stopPropagation();
          togglePartStageStatus(p);
        } else {
          selectPanelById(p.id, 'assembly');
        }
      };

      el.assemblyPartsList.appendChild(card);
    }
  }

  if (activePanel && el.assemblyActiveBanner) {
    el.assemblyActiveBanner.classList.remove('hidden');
    if (el.activePartName) el.activePartName.textContent = `${activePanel.name} [${activePanel.partCode}]`;
  } else if (el.assemblyActiveBanner) {
    el.assemblyActiveBanner.classList.add('hidden');
  }

  renderHardwareDetailPanel();
}

function renderHardwareDetailPanel() {
  if (!activePanel) {
    if (el.hwPartCodeBadge) el.hwPartCodeBadge.textContent = '—';
    if (el.specPartTitle) el.specPartTitle.textContent = 'No Part Selected';
    if (el.specDim) el.specDim.textContent = '—';
    if (el.specMat) el.specMat.textContent = '—';
    if (el.specGrain) el.specGrain.textContent = '—';
    if (el.specStatus) el.specStatus.textContent = '—';
    if (el.specEdgeband) el.specEdgeband.innerHTML = '';
    if (el.hardwareCardsList) el.hardwareCardsList.innerHTML = '<div class="empty-hint" style="position:static">Scan a part barcode or select from checklist to view hardware.</div>';
    if (el.hwCountBadge) el.hwCountBadge.textContent = '0 items';
    return;
  }

  if (el.hwPartCodeBadge) el.hwPartCodeBadge.textContent = activePanel.partCode || activePanel.id;
  if (el.specPartTitle) el.specPartTitle.textContent = `${activePanel.name} (${activePanel.panelType})`;
  if (el.specDim) el.specDim.textContent = `${fmt(activePanel.width)} × ${fmt(activePanel.height)} × ${activePanel.thickness} mm`;
  if (el.specMat) el.specMat.textContent = activePanel.material;
  if (el.specGrain) el.specGrain.textContent = activePanel.grain || 'none';
  if (el.specStatus) el.specStatus.textContent = (activePanel.status || 'pending_cut').toUpperCase().replace('_', ' ');

  if (el.specEdgeband) {
    el.specEdgeband.innerHTML = '';
    if (activePanel.edgeband && activePanel.edgeband.length) {
      for (const eb of activePanel.edgeband) {
        const pill = document.createElement('span');
        pill.className = 'badge band';
        pill.style.background = '#1e293b';
        pill.style.color = '#cbd5e1';
        pill.textContent = `Edge ${eb.edge}: ${eb.material}`;
        el.specEdgeband.appendChild(pill);
      }
    } else {
      el.specEdgeband.innerHTML = '<span class="muted" style="font-size:11px">No edge banding required</span>';
    }
  }

  const hwList = activePanel.hardware || [];
  if (el.hwCountBadge) el.hwCountBadge.textContent = `${hwList.length} items`;
  if (el.hardwareCardsList) {
    el.hardwareCardsList.innerHTML = '';

    if (hwList.length === 0) {
      el.hardwareCardsList.innerHTML = '<div class="card muted" style="padding:10px; font-size:11.5px">No pre-assembly hardware fittings required for this panel. Ready to assemble.</div>';
    } else {
      for (let i = 0; i < hwList.length; i++) {
        const h = hwList[i];
        const card = document.createElement('div');
        card.className = 'hw-card';

        let icon = '🔩';
        let title = h.kind;
        let actionText = `Mount on ${h.face} face`;

        if (h.category === 'hinge' || h.kind.toLowerCase().includes('hinge')) {
          icon = '🚪';
          title = 'Hinge 35mm Cup';
          actionText = `Press-fit 35mm hinge cup at (${fmt(h.x)}, ${fmt(h.y)}) mm`;
        } else if (h.category === 'slide' || h.kind.toLowerCase().includes('slide') || h.kind.toLowerCase().includes('runner')) {
          icon = '🗄️';
          title = 'Drawer Slide Runner (32mm System)';
          actionText = `Attach runner along ${h.face} face at Y=${fmt(h.y)}mm`;
        } else if (h.category === 'shelf_pin' || h.kind.toLowerCase().includes('shelf') || h.kind.toLowerCase().includes('pin')) {
          icon = '📍';
          title = 'Shelf Support Pin Ø5mm';
          actionText = `Insert 5mm shelf support pin into hole at (${fmt(h.x)}, ${fmt(h.y)}) mm`;
        } else if (h.category === 'dowel' || h.kind.toLowerCase().includes('dowel')) {
          icon = '🪵';
          title = 'Wooden Dowel Ø8mm';
          actionText = `Insert 8x30mm dowel into ${h.face === 'edge' ? `${h.edge || 'edge'} bore` : 'face'} at (${fmt(h.x)}, ${fmt(h.y)}) mm`;
        } else if (h.category === 'connector' || h.kind.toLowerCase().includes('minifix') || h.kind.toLowerCase().includes('cam')) {
          icon = '🔗';
          title = 'Minifix Cam Connector';
          actionText = `Insert cam lock housing at (${fmt(h.x)}, ${fmt(h.y)}) mm`;
        } else if (h.category === 'screw' || h.kind.toLowerCase().includes('screw')) {
          icon = '🪛';
          title = 'Back Panel Fastening Screw';
          actionText = `Fasten rear screw at (${fmt(h.x)}, ${fmt(h.y)}) mm`;
        }

        card.innerHTML = `
          <div class="hw-icon-box">${icon}</div>
          <div class="hw-info">
            <div class="hw-name-row">
              <span class="hw-name">${escapeHtml(title)}</span>
              <span class="hw-qty-badge">×${h.qty || 1}</span>
            </div>
            <div class="hw-instruction">${escapeHtml(actionText)}</div>
            <div class="hw-coords">Coords: (${fmt(h.x)}, ${fmt(h.y)}) mm · Face: ${h.face.toUpperCase()}${h.edge ? ` (${h.edge})` : ''}${h.depth ? ` · Depth: ${fmt(h.depth)}mm` : ''}</div>
          </div>
        `;

        el.hardwareCardsList.appendChild(card);
      }
    }
  }

  if (el.btnToggleStageCurrent) {
    const isStaged = activePanel.status === 'staged' || activePanel.status === 'assembled';
    el.btnToggleStageCurrent.textContent = isStaged ? '✔ Panel Staged (Click to Toggle)' : 'Mark Panel as Staged for Assembly';
    el.btnToggleStageCurrent.className = isStaged ? 'btn ok full-width' : 'btn full-width';
  }
}

async function togglePartStageStatus(panel) {
  const newStatus = panel.status === 'staged' ? 'assembled' : panel.status === 'assembled' ? 'pending_cut' : 'staged';
  await updatePartStatus(panel.id, newStatus, 'assembly');
}

async function updatePartStatus(panelId, status, station) {
  try {
    const res = await api(`/api/projects/${encodeURIComponent(state.project.id)}/parts/${encodeURIComponent(panelId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, station }),
    });

    if (res.ok) {
      state.project = await api(`/api/projects/${encodeURIComponent(state.project.id)}`);
      activeCabinet = state.project.cabinets.find((c) => c.panels.some((p) => p.id === panelId)) || activeCabinet;
      activePanel = activeCabinet.panels.find((p) => p.id === panelId) || activePanel;

      if (soundEnabled && (status === 'staged' || status === 'assembled')) {
        playSuccessChime();
      }

      renderAssemblyStation();
      renderCncStation();
      renderSawStation();

      getV3d().then((v3d) => {
        v3d.highlight(activePanel ? activePanel.id : null, true);
      });
    }
  } catch (e) {
    setStatus(`Status update failed: ${e.message}`, 'error');
  }
}

function selectPanelById(panelId, sourceStation = activeStation) {
  if (!state.project) return;

  for (const cab of state.project.cabinets) {
    const p = cab.panels.find((x) => x.id === panelId || x.partCode === panelId);
    if (p) {
      activeCabinet = cab;
      activePanel = p;
      break;
    }
  }

  renderCabinetSelector();
  renderAssemblyStation();
  renderCncStation();

  getV3d().then((v3d) => {
    v3d.highlight(activePanel ? activePanel.id : null, true);
  });

  if (v2dCnc && activePanel) {
    v2dCnc.setPanel(activePanel);
  }
}

// ---------------------------------------------------------------------------
// Module B: CNC Operator Station (Biesse Rover A)
// ---------------------------------------------------------------------------
function renderCncStation() {
  if (!state.project || !el.cncPartQueue) return;

  el.cncPartQueue.innerHTML = '';
  const allPanels = state.project.cabinets.flatMap((c) => c.panels);

  for (const p of allPanels) {
    const isTarget = activePanel && activePanel.id === p.id;
    const card = document.createElement('div');
    card.className = `part-card ${isTarget ? 'active' : ''} ${p.status}`;

    card.innerHTML = `
      <div class="part-card-top">
        <span class="part-title-text">${escapeHtml(p.name)}</span>
        <span class="badge ${p.status === 'machined' ? 'ok' : 'pending'}">${p.status.toUpperCase()}</span>
      </div>
      <div class="part-card-meta">
        <span class="part-code-tag">${escapeHtml(p.cixFileName || `${p.partCode}.cix`)}</span>
        <span>${fmt(p.width)} × ${fmt(p.height)} mm</span>
      </div>
    `;

    card.onclick = () => {
      selectPanelById(p.id, 'cnc');
    };

    el.cncPartQueue.appendChild(card);
  }

  if (activePanel) {
    if (el.cncActivePartTitle) el.cncActivePartTitle.textContent = `${activePanel.name} (${activePanel.partCode}) — ${activePanel.width}x${activePanel.height}x${activePanel.thickness}mm`;
    if (v2dCnc) v2dCnc.setPanel(activePanel);
    fetchCixCode(activePanel.id);
  } else {
    if (el.cncActivePartTitle) el.cncActivePartTitle.textContent = 'Select a part to preview machining';
    if (el.cixCodePreview) el.cixCodePreview.textContent = '; Select a part or scan barcode to view .cix code';
  }
}

async function fetchCixCode(panelId) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(state.project.id)}/cix/${encodeURIComponent(panelId)}`);
    if (res.ok && el.cixCodePreview) {
      const code = await res.text();
      el.cixCodePreview.textContent = code;
    }
  } catch (e) {
    if (el.cixCodePreview) el.cixCodePreview.textContent = `; Error loading .cix program: ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// Module A: Cut Rite & Beam Saw Pipeline
// ---------------------------------------------------------------------------
async function renderSawStation() {
  if (!state.project) return;

  try {
    const cutrite = await api(`/api/projects/${encodeURIComponent(state.project.id)}/cutrite`);
    if (el.btnDownloadCutRiteCsv) el.btnDownloadCutRiteCsv.href = `/api/projects/${encodeURIComponent(state.project.id)}/cutrite.csv`;
    if (el.cutRitePartCount) el.cutRitePartCount.textContent = `${cutrite.totalParts} parts (${cutrite.totalInstances} total instances)`;
    if (el.syncStatText) el.syncStatText.textContent = `${cutrite.synchronizedCount} of ${cutrite.totalParts} parts have 100% synchronized Part Codes, Barcodes, and bSolid .cix file names.`;

    if (el.cutRiteTableBody) {
      el.cutRiteTableBody.innerHTML = '';
      for (const r of cutrite.rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono" style="font-weight:700; color:var(--accent)">${escapeHtml(r.partCode)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${escapeHtml(r.material)}</td>
          <td>${fmt(r.length)}</td>
          <td>${fmt(r.width)}</td>
          <td>${r.thickness}</td>
          <td><b>${r.quantity}</b></td>
          <td>${r.grain === 1 ? 'Length' : r.grain === 2 ? 'Width' : 'None'}</td>
          <td>${escapeHtml(r.edgeL1 || '—')}</td>
          <td>${escapeHtml(r.edgeL2 || '—')}</td>
          <td>${escapeHtml(r.edgeW1 || '—')}</td>
          <td>${escapeHtml(r.edgeW2 || '—')}</td>
          <td class="mono" style="color:#93c5fd">${escapeHtml(r.cncProgram)}</td>
          <td class="mono" style="color:var(--emerald)">${escapeHtml(r.barcode)}</td>
        `;
        el.cutRiteTableBody.appendChild(tr);
      }
    }

    const labels = await api(`/api/projects/${encodeURIComponent(state.project.id)}/labels`);
    if (el.sawLabelsGrid) {
      el.sawLabelsGrid.innerHTML = '';
      for (const lb of labels) {
        let barcodeSvg = '';
        try {
          barcodeSvg = code128(lb.barcode);
        } catch {}

        const card = document.createElement('div');
        card.className = 'label-card';
        card.innerHTML = `
          <div class="lc-top">
            <span>${escapeHtml(lb.name)}</span>
            <span class="mono">${escapeHtml(lb.partCode)}</span>
          </div>
          <div class="lc-meta">
            <b>Cabinet:</b><span>${escapeHtml(lb.cabinet)}</span>
            <b>Size:</b><span>${fmt(lb.width)} × ${fmt(lb.height)} × ${lb.thickness} mm</span>
            <b>Material:</b><span>${escapeHtml(lb.material)}</span>
            <b>Edge:</b><span>${escapeHtml(lb.edgeband || 'None')}</span>
            <b>CIX File:</b><span class="mono">${escapeHtml(lb.cixFileName)}</span>
          </div>
          <div class="lc-barcode">${barcodeSvg}</div>
        `;
        el.sawLabelsGrid.appendChild(card);
      }
    }
  } catch (e) {
    console.error('[saw render error]', e);
  }
}

// ---------------------------------------------------------------------------
// CAM, Pre-Flight & Settings
// ---------------------------------------------------------------------------
async function renderCamStation() {
  if (!state.project) return;

  try {
    const val = await api(`/api/projects/${encodeURIComponent(state.project.id)}/validation`);
    if (el.preflightSummary) {
      el.preflightSummary.innerHTML = `
        <div class="kpi"><div class="k">Validation Status</div><div class="v ${val.ok ? 'good' : 'bad'}">${val.ok ? '✔ PASSED' : '✖ BLOCKED'}</div></div>
        <div class="kpi"><div class="k">Blocking Errors</div><div class="v ${val.errorCount > 0 ? 'bad' : 'good'}">${val.errorCount}</div></div>
        <div class="kpi"><div class="k">Warnings</div><div class="v ${val.warningCount > 0 ? 'warn' : 'good'}">${val.warningCount}</div></div>
      `;
    }

    if (el.preflightIssues) {
      el.preflightIssues.innerHTML = '';
      if (val.issues.length === 0) {
        el.preflightIssues.innerHTML = '<div class="card ok" style="padding:10px; font-size:12px; color:var(--ok)">✔ All pre-flight safety checks passed. Machine instructions validated.</div>';
      } else {
        for (const issue of val.issues) {
          const div = document.createElement('div');
          div.className = `card ${issue.severity === 'error' ? 'danger' : 'warn'}`;
          div.style.padding = '8px 12px';
          div.style.marginBottom = '6px';
          div.innerHTML = `<strong>[${issue.severity.toUpperCase()}] ${issue.code}:</strong> Part ${escapeHtml(issue.panelId)} — ${escapeHtml(issue.message)}`;
          el.preflightIssues.appendChild(div);
        }
      }
    }
  } catch (e) {}

  if (v2dCam && activePanel && el.chkCadDrills) {
    v2dCam.setPanel(activePanel, {
      showDrills: el.chkCadDrills.checked,
      showGrooves: el.chkCadGrooves.checked,
      showBand: el.chkCadBand.checked,
      showOrigins: el.chkCadOrigins.checked,
    });
  }

  renderWorkshopSettings();
}

function renderWorkshopSettings() {
  if (!state.settings) return;
  const s = state.settings;
  if (el.cfgProtocol) el.cfgProtocol.value = s.network.protocol;
  if (el.cfgTargetDir) el.cfgTargetDir.value = s.network.targetDir;

  if (el.cfgMachineFoldersList) {
    el.cfgMachineFoldersList.innerHTML = '';
    s.network.machineFolders.forEach((m, idx) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.marginBottom = '6px';
      row.innerHTML = `
        <input type="text" data-idx="${idx}" data-field="name" value="${escapeHtml(m.name)}" style="flex:0 0 140px" />
        <input type="text" data-idx="${idx}" data-field="folder" value="${escapeHtml(m.folder)}" style="flex:1" />
        <button class="btn small ghost danger" data-idx="${idx}">✕</button>
      `;
      row.querySelector('button').onclick = () => {
        s.network.machineFolders.splice(idx, 1);
        renderWorkshopSettings();
      };
      el.cfgMachineFoldersList.appendChild(row);
    });
  }

  if (el.cfgToolingTableBody) {
    el.cfgToolingTableBody.innerHTML = '';
    for (const t of s.tooling.tools) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${escapeHtml(t.id)}</td>
        <td>${escapeHtml(t.name)}</td>
        <td><span class="badge info">${t.type}</span></td>
        <td>Ø${t.diameter} mm</td>
        <td><b>Spindle ${t.spindle ?? '—'}</b></td>
      `;
      el.cfgToolingTableBody.appendChild(tr);
    }
  }
}

async function saveWorkshopSettings() {
  const s = state.settings;
  if (el.cfgProtocol) s.network.protocol = el.cfgProtocol.value;
  if (el.cfgTargetDir) s.network.targetDir = el.cfgTargetDir.value.trim();

  $$('#cfgMachineFoldersList .row').forEach((row) => {
    const nameInp = row.querySelector('[data-field=name]');
    const folderInp = row.querySelector('[data-field=folder]');
    const idx = Number(nameInp.dataset.idx);
    if (s.network.machineFolders[idx]) {
      s.network.machineFolders[idx].name = nameInp.value.trim();
      s.network.machineFolders[idx].folder = folderInp.value.trim();
    }
  });

  state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
  if (el.settingsSaveMsg) {
    el.settingsSaveMsg.textContent = '✔ Settings saved.';
    setTimeout(() => {
      if (el.settingsSaveMsg) el.settingsSaveMsg.textContent = '';
    }, 2500);
  }
}

// ---------------------------------------------------------------------------
// UI Event Bindings
// ---------------------------------------------------------------------------
function bindUIEvents() {
  // Station Tabs
  if (el.stationNav) {
    el.stationNav.querySelectorAll('.station-tab').forEach((tab) => {
      tab.onclick = () => switchStation(tab.dataset.station);
    });
  }

  // Project select
  if (el.projectSelect) {
    el.projectSelect.onchange = () => {
      if (el.projectSelect.value) openProject(el.projectSelect.value);
    };
  }

  // Manual Barcode Scan
  if (el.btnManualScan) {
    el.btnManualScan.onclick = () => {
      if (el.barcodeManualInput) {
        handleBarcodeScan(el.barcodeManualInput.value, activeStation);
        el.barcodeManualInput.value = '';
      }
    };
  }
  if (el.barcodeManualInput) {
    el.barcodeManualInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        handleBarcodeScan(el.barcodeManualInput.value, activeStation);
        el.barcodeManualInput.value = '';
      }
    };
  }

  // Top Buttons
  if (el.btnLoadSample) el.btnLoadSample.onclick = loadDemoKitchen;
  if (el.btnLoadSampleCam) el.btnLoadSampleCam.onclick = loadDemoKitchen;
  if (el.toastClose) el.toastClose.onclick = () => el.scanToast && el.scanToast.classList.add('hidden');
  if (el.btnAudioToggle) {
    el.btnAudioToggle.onclick = () => {
      soundEnabled = !soundEnabled;
      el.btnAudioToggle.textContent = soundEnabled ? '🔊 Sound' : '🔇 Muted';
    };
  }
  if (el.btnSettings) {
    el.btnSettings.onclick = () => {
      switchStation('cam');
      switchCamTab('settings');
    };
  }

  // Assembly Station Controls
  if (el.assemblyCabinetSelect) {
    el.assemblyCabinetSelect.onchange = () => {
      const cabId = el.assemblyCabinetSelect.value;
      activeCabinet = state.project.cabinets.find((c) => c.id === cabId) || activeCabinet;
      if (activeCabinet.panels.length > 0) activePanel = activeCabinet.panels[0];
      renderAssemblyStation();
      getV3d().then((v3d) => {
        v3d.setProject(state.project, { cabinetId: activeCabinet.id, panelId: activePanel.id });
      });
    };
  }

  if (el.btn3dReset) {
    el.btn3dReset.onclick = () => {
      getV3d().then((v3d) => v3d.resetView());
    };
  }

  if (el.btn3dFullBatch) {
    el.btn3dFullBatch.onclick = () => {
      getV3d().then((v3d) => v3d.setProject(state.project, {}));
    };
  }

  // Exploded View Slider (Module D)
  if (el.sliderExplode) {
    el.sliderExplode.oninput = () => {
      const factor = Number(el.sliderExplode.value) / 100;
      if (el.explodeVal) el.explodeVal.textContent = `${el.sliderExplode.value}%`;
      getV3d().then((v3d) => v3d.setExplode(factor));
    };
  }

  // Ghost Mode Checkbox
  if (el.chkGhostMode) {
    el.chkGhostMode.onchange = () => {
      getV3d().then((v3d) => v3d.setGhostMode(el.chkGhostMode.checked));
    };
  }

  // Staging actions
  if (el.btnToggleStageCurrent) {
    el.btnToggleStageCurrent.onclick = () => {
      if (activePanel) togglePartStageStatus(activePanel);
    };
  }

  if (el.btnMarkCabAssembled) {
    el.btnMarkCabAssembled.onclick = async () => {
      if (!activeCabinet) return;
      for (const p of activeCabinet.panels) {
        await updatePartStatus(p.id, 'staged', 'assembly');
      }
      if (soundEnabled) playStageChime();
      showScanToast(`Cabinet ${activeCabinet.name} Staged`, `All ${activeCabinet.panels.length} parts ready for assembly.`, 'ok');
    };
  }

  if (el.btnResetBatchStatus) {
    el.btnResetBatchStatus.onclick = async () => {
      if (confirm('Reset tracking status for all parts in this project?')) {
        await api(`/api/projects/${encodeURIComponent(state.project.id)}/reset-status`, { method: 'POST' });
        state.project = await api(`/api/projects/${encodeURIComponent(state.project.id)}`);
        renderAssemblyStation();
        renderCncStation();
        renderSawStation();
        showScanToast('Tracking Reset', 'All parts reset to pending_cut.', 'ok');
      }
    };
  }

  // CNC Station Controls
  if (el.btnDistributeLan) {
    el.btnDistributeLan.onclick = async () => {
      try {
        setStatus('Pushing compiled CIX batch to Rover A LAN directory…');
        const res = await api(`/api/projects/${encodeURIComponent(state.project.id)}/distribute`, {
          method: 'POST',
          body: JSON.stringify({ settings: state.settings }),
        });
        if (res.ok) {
          showScanToast('LAN Drop Successful', `Pushed ${res.files.length} .cix programs to Rover A.`, 'ok');
          setStatus(`✔ Successfully pushed ${res.files.length} .cix files over LAN.`, 'ok');
        } else {
          showScanToast('LAN Drop Blocked', 'Pre-flight errors prevented distribution.', 'error');
        }
      } catch (e) {
        setStatus(`LAN drop error: ${e.message}`, 'error');
      }
    };
  }

  if (el.btnMarkCncComplete) {
    el.btnMarkCncComplete.onclick = () => {
      if (activePanel) updatePartStatus(activePanel.id, 'machined', 'cnc');
    };
  }

  if (el.btnDownloadCix) {
    el.btnDownloadCix.onclick = () => {
      if (activePanel) {
        window.location.href = `/api/projects/${encodeURIComponent(state.project.id)}/cix/${encodeURIComponent(activePanel.id)}`;
      }
    };
  }

  // Saw Print Labels
  if (el.btnPrintLabelsFromSaw) el.btnPrintLabelsFromSaw.onclick = () => window.print();
  if (el.btnPrintAllLabels) el.btnPrintAllLabels.onclick = () => window.print();

  // CAM Tabs
  el.camTabs.forEach((tab) => {
    tab.onclick = () => switchCamTab(tab.dataset.camTab);
  });

  // Dropzone & File Uploads
  if (el.dropzoneMain) {
    el.dropzoneMain.onclick = () => el.fileInputMain && el.fileInputMain.click();
    el.dropzoneMain.ondragover = (e) => {
      e.preventDefault();
      el.dropzoneMain.classList.add('drag');
    };
    el.dropzoneMain.ondragleave = () => el.dropzoneMain.classList.remove('drag');
    el.dropzoneMain.ondrop = async (e) => {
      e.preventDefault();
      el.dropzoneMain.classList.remove('drag');
      const files = [...e.dataTransfer.files];
      if (files.length) await handleBatchUpload(files);
    };
  }

  if (el.fileInputMain) {
    el.fileInputMain.onchange = async () => {
      await handleBatchUpload([...el.fileInputMain.files]);
      el.fileInputMain.value = '';
    };
  }
  if (el.folderInputMain) {
    el.folderInputMain.onchange = async () => {
      await handleBatchUpload([...el.folderInputMain.files], true);
      el.folderInputMain.value = '';
    };
  }

  // CAD 2D layer toggles
  const updateCad2d = () => {
    if (v2dCam && activePanel) {
      v2dCam.setPanel(activePanel, {
        showDrills: el.chkCadDrills ? el.chkCadDrills.checked : true,
        showGrooves: el.chkCadGrooves ? el.chkCadGrooves.checked : true,
        showBand: el.chkCadBand ? el.chkCadBand.checked : true,
        showOrigins: el.chkCadOrigins ? el.chkCadOrigins.checked : true,
      });
    }
  };
  if (el.chkCadDrills) el.chkCadDrills.onchange = updateCad2d;
  if (el.chkCadGrooves) el.chkCadGrooves.onchange = updateCad2d;
  if (el.chkCadBand) el.chkCadBand.onchange = updateCad2d;
  if (el.chkCadOrigins) el.chkCadOrigins.onchange = updateCad2d;

  if (el.btnRevalidate) el.btnRevalidate.onclick = renderCamStation;
  if (el.btnSaveWorkshopSettings) el.btnSaveWorkshopSettings.onclick = saveWorkshopSettings;
  if (el.btnAddMachineFolder) {
    el.btnAddMachineFolder.onclick = () => {
      state.settings.network.machineFolders.push({ name: 'New Machine', folder: 'new-station' });
      renderWorkshopSettings();
    };
  }
}

async function handleBatchUpload(files, folderMode = false) {
  if (!files.length) return;
  if (el.camImportStatus) {
    el.camImportStatus.textContent = 'Parsing Polyboard batch…';
    el.camImportStatus.className = 'import-status';
  }

  try {
    const list = [];
    for (const f of files) {
      const content = await f.text();
      list.push({ name: folderMode ? (f.webkitRelativePath || f.name) : f.name, content });
    }

    const name = folderMode && files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : `Imported ${new Date().toISOString().slice(0, 10)}`;

    const result = await api('/api/import', {
      method: 'POST',
      body: JSON.stringify({ name, files: list }),
    });

    if (el.camImportStatus) {
      el.camImportStatus.textContent = `✔ Successfully imported ${result.project.stats.panels} parts across ${result.project.stats.cabinets} cabinets.`;
      el.camImportStatus.className = 'import-status ok';
    }

    await refreshProjects();
    await openProject(result.projectId);
    switchStation('assembly');
  } catch (e) {
    if (el.camImportStatus) {
      el.camImportStatus.textContent = `✖ Import failed: ${e.message}`;
      el.camImportStatus.className = 'import-status error';
    }
  }
}

function switchStation(stationName) {
  activeStation = stationName;
  if (el.stationNav) {
    el.stationNav.querySelectorAll('.station-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.station === stationName);
    });
  }

  for (const [key, dom] of Object.entries(el.views)) {
    if (dom) {
      dom.classList.toggle('hidden', key !== stationName);
      dom.classList.toggle('active', key === stationName);
    }
  }

  requestAnimationFrame(() => {
    if (stationName === 'assembly') getV3d().then((v) => v.resize());
    if (stationName === 'cnc' && v2dCnc) v2dCnc.resize();
    if (stationName === 'cam' && v2dCam) v2dCam.resize();
  });
}

function switchCamTab(tabName) {
  el.camTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.camTab === tabName);
  });
  for (const [key, dom] of Object.entries(el.camPanels)) {
    if (dom) dom.classList.toggle('hidden', key !== tabName);
  }
  if (tabName === 'cad2d' && v2dCam) {
    requestAnimationFrame(() => v2dCam.resize());
  }
}

function setStatus(msg, kind = 'ok') {
  if (el.statusText) el.statusText.textContent = msg;
  if (el.statusbar) {
    const dot = el.statusbar.querySelector('.dot');
    if (dot) {
      dot.style.background = kind === 'error' ? 'var(--error)' : 'var(--ok)';
    }
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Start immediately on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => console.error('[Init error]', e));
  });
} else {
  init().catch((e) => console.error('[Init error]', e));
}
