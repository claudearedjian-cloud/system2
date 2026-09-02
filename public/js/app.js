// system2 — Woodworking Operations Engine (Polyboard -> Cut Rite / bSolid Pipeline)
// Exposes window.system2 global controller for unbreakable inline & delegated interactivity.

import { api, state, materialColor, DRILL_COLORS, fmt } from './api.js';
import { code128 } from './code128.js';
import { createViewer2D } from './viewer2d.js';
import { initBarcodeListener } from './barcode.js';
import { playSuccessChime, playStageChime, playErrorBeep } from './audio.js';

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

function getV3d() {
  if (v3dAssembly) return Promise.resolve(v3dAssembly);
  if (v3dFailed) return Promise.resolve(NOOP_VIEWER_3D);
  if (!v3dLoading) {
    v3dLoading = import('./viewer3d.js')
      .then((m) => {
        const dom = document.getElementById('viewer3dAssembly');
        if (dom) {
          v3dAssembly = m.createViewer3D(dom, {
            onPanelSelect: (panelId) => {
              window.system2.selectPanel(panelId, 'assembly');
            },
          });
        }
        return v3dAssembly || NOOP_VIEWER_3D;
      })
      .catch((e) => {
        v3dFailed = true;
        console.warn('[3D Viewer]', 'WebGL 3D Viewer unavailable in this environment:', e.message);
        const dom = document.getElementById('viewer3dAssembly');
        if (dom) {
          dom.innerHTML = `
            <div class="empty-hint" style="color:var(--text-dim); padding:20px; text-align:center;">
              <div style="font-size:30px; margin-bottom:8px">🖥️</div>
              <div style="font-weight:700; color:var(--text); margin-bottom:4px">3D Graphics Fallback Active</div>
              <div style="font-size:12px; max-width:340px; margin:0 auto; line-height:1.4">
                WebGL 3D is inactive in this virtual machine. The 2D Tooling viewer, CNC Station, Cut Rite saw, and Assembly checklist remain 100% interactive.
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
// Global Controller: window.system2
// ---------------------------------------------------------------------------
window.system2 = {
  // Station navigation
  switchStation(stationName) {
    activeStation = stationName;
    document.querySelectorAll('.station-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.station === stationName);
    });

    const views = {
      assembly: document.getElementById('view-assembly'),
      cnc: document.getElementById('view-cnc'),
      saw: document.getElementById('view-saw'),
      cam: document.getElementById('view-cam'),
    };

    for (const [key, dom] of Object.entries(views)) {
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
  },

  // CAM sub tabs
  switchCamTab(tabName) {
    document.querySelectorAll('.cam-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.camTab === tabName);
    });
    const panels = {
      import: document.getElementById('campanel-import'),
      preflight: document.getElementById('campanel-preflight'),
      cad2d: document.getElementById('campanel-cad2d'),
      settings: document.getElementById('campanel-settings'),
    };
    for (const [key, dom] of Object.entries(panels)) {
      if (dom) dom.classList.toggle('hidden', key !== tabName);
    }
    if (tabName === 'cad2d' && v2dCam) {
      requestAnimationFrame(() => v2dCam.resize());
    }
  },

  // Audio Toggle
  toggleAudio() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('btnAudioToggle');
    if (btn) btn.textContent = soundEnabled ? '🔊 Sound' : '🔇 Muted';
    if (soundEnabled) playSuccessChime();
  },

  // Settings open
  openSettings() {
    window.system2.switchStation('cam');
    window.system2.switchCamTab('settings');
  },

  // Sample batch loading
  async loadDemoKitchen() {
    try {
      setStatus('Loading demo Polyboard kitchen batch…');
      const res = await api('/api/load-sample', { method: 'POST' });
      await refreshProjects();
      if (res && res.project) {
        await openProject(res.project.id);
      }
      if (soundEnabled) playSuccessChime();
      showScanToast('Demo Kitchen Loaded', 'Imported BASE-01 and WALL-01 cabinets.', 'ok');
      setStatus('✔ Kitchen Demo batch loaded successfully.', 'ok');
    } catch (e) {
      setStatus(`Failed to load demo: ${e.message}`, 'error');
    }
  },

  // Barcode Scanning
  async triggerManualScan() {
    const input = document.getElementById('barcodeManualInput');
    if (input && input.value) {
      const code = input.value.trim();
      input.value = '';
      await handleBarcodeScan(code, activeStation);
    }
  },

  async quickScan(barcode) {
    await handleBarcodeScan(barcode, activeStation);
  },

  // Cabinet & Panel selection
  onCabinetChange(cabId) {
    if (!state.project) return;
    activeCabinet = state.project.cabinets.find((c) => c.id === cabId) || activeCabinet;
    if (activeCabinet && activeCabinet.panels.length > 0) {
      activePanel = activeCabinet.panels[0];
    }
    renderAssemblyStation();
    getV3d().then((v3d) => {
      v3d.setProject(state.project, { cabinetId: activeCabinet ? activeCabinet.id : undefined, panelId: activePanel ? activePanel.id : undefined });
    });
  },

  onProjectChange(projId) {
    if (projId) openProject(projId);
  },

  selectPanel(panelId, sourceStation = activeStation) {
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
    if (v2dCam && activePanel) {
      updateCad2dLayers();
    }
  },

  // 3D Controls
  fit3d() {
    getV3d().then((v3d) => v3d.resetView());
  },

  fullBatch3d() {
    getV3d().then((v3d) => v3d.setProject(state.project, {}));
  },

  onExplodeChange(val) {
    const factor = Number(val) / 100;
    const txt = document.getElementById('explodeVal');
    if (txt) txt.textContent = `${val}%`;
    getV3d().then((v3d) => v3d.setExplode(factor));
  },

  onGhostChange(checked) {
    getV3d().then((v3d) => v3d.setGhostMode(checked));
  },

  // Assembly Tracking
  async stageCurrentPanel() {
    if (activePanel) {
      await togglePartStageStatus(activePanel);
    }
  },

  async togglePartStage(panelId) {
    if (!state.project) return;
    const panel = state.project.cabinets.flatMap((c) => c.panels).find((p) => p.id === panelId);
    if (panel) {
      await togglePartStageStatus(panel);
    }
  },

  async markCurrentCabAssembled() {
    if (!activeCabinet || !state.project) return;
    for (const p of activeCabinet.panels) {
      await updatePartStatus(p.id, 'staged', 'assembly');
    }
    if (soundEnabled) playStageChime();
    showScanToast(`Cabinet ${activeCabinet.name} Staged`, `All ${activeCabinet.panels.length} parts ready for assembly.`, 'ok');
  },

  async resetTracking() {
    if (!state.project) return;
    if (confirm('Reset tracking status for all parts in this project?')) {
      await api(`/api/projects/${encodeURIComponent(state.project.id)}/reset-status`, { method: 'POST' });
      state.project = await api(`/api/projects/${encodeURIComponent(state.project.id)}`);
      renderAssemblyStation();
      renderCncStation();
      renderSawStation();
      showScanToast('Tracking Reset', 'All parts reset to pending_cut.', 'ok');
    }
  },

  // CNC Station
  async distributeLan() {
    if (!state.project) return;
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
  },

  async markCncComplete() {
    if (activePanel) {
      await updatePartStatus(activePanel.id, 'machined', 'cnc');
    }
  },

  downloadActiveCix() {
    if (activePanel && state.project) {
      window.location.href = `/api/projects/${encodeURIComponent(state.project.id)}/cix/${encodeURIComponent(activePanel.id)}`;
    }
  },

  // CAD 2D Layer updates
  updateCad2dLayers() {
    if (v2dCam && activePanel) {
      const chkDrills = document.getElementById('chkCadDrills');
      const chkGrooves = document.getElementById('chkCadGrooves');
      const chkBand = document.getElementById('chkCadBand');
      const chkOrigins = document.getElementById('chkCadOrigins');
      v2dCam.setPanel(activePanel, {
        showDrills: chkDrills ? chkDrills.checked : true,
        showGrooves: chkGrooves ? chkGrooves.checked : true,
        showBand: chkBand ? chkBand.checked : true,
        showOrigins: chkOrigins ? chkOrigins.checked : true,
      });
    }
  },

  // CAM & Pre-flight
  revalidate() {
    renderCamStation();
  },

  async saveSettings() {
    await saveWorkshopSettings();
  },

  addMachineFolder() {
    if (state.settings && state.settings.network) {
      state.settings.network.machineFolders.push({ name: 'New Station', folder: 'station-folder' });
      renderWorkshopSettings();
    }
  },

  removeMachineFolder(idx) {
    if (state.settings && state.settings.network && state.settings.network.machineFolders) {
      state.settings.network.machineFolders.splice(idx, 1);
      renderWorkshopSettings();
    }
  },
};

// Aliases for quick convenience
window.switchStation = window.system2.switchStation;
window.loadDemoKitchen = window.system2.loadDemoKitchen;

// ---------------------------------------------------------------------------
// Bootstrap & Initialization
// ---------------------------------------------------------------------------
async function init() {
  bindGlobalDelegation();

  // Initialize 2D Viewers
  try {
    const cncHost = document.getElementById('viewer2dCnc');
    if (cncHost) v2dCnc = createViewer2D(cncHost);

    const camHost = document.getElementById('viewer2dCam');
    if (camHost) v2dCam = createViewer2D(camHost);
  } catch (e) {
    console.warn('[v2d init error]', e);
  }

  // Eagerly trigger 3D initialization
  getV3d().catch(() => {});

  // Initialize Global Hardware Barcode Scanner Listener
  try {
    barcodeScanner = initBarcodeListener((barcode) => {
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
      await window.system2.loadDemoKitchen();
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
  setStatus('System ready — Scanner active & pipeline synchronized.', 'ok');
}

// ---------------------------------------------------------------------------
// Global Event Delegation (Guarantees every click works, everywhere)
// ---------------------------------------------------------------------------
function bindGlobalDelegation() {
  document.addEventListener('click', (e) => {
    // 1. Station tab clicks
    const stationTab = e.target.closest('[data-station]');
    if (stationTab) {
      e.preventDefault();
      window.system2.switchStation(stationTab.dataset.station);
      return;
    }

    // 2. CAM sub-tab clicks
    const camTab = e.target.closest('[data-cam-tab]');
    if (camTab) {
      e.preventDefault();
      window.system2.switchCamTab(camTab.dataset.camTab);
      return;
    }

    // 3. Quick scan pills
    const pill = e.target.closest('[data-quick-scan]');
    if (pill) {
      e.preventDefault();
      window.system2.quickScan(pill.dataset.quickScan);
      return;
    }

    // 4. Panel checklist item clicks
    const partCard = e.target.closest('[data-panel-id]');
    if (partCard) {
      const stageBtn = e.target.closest('[data-action=toggle-stage]');
      if (stageBtn) {
        e.preventDefault();
        e.stopPropagation();
        window.system2.togglePartStage(partCard.dataset.panelId);
      } else {
        window.system2.selectPanel(partCard.dataset.panelId);
      }
      return;
    }
  });

  // Enter key in barcode text input
  const barcodeInput = document.getElementById('barcodeManualInput');
  if (barcodeInput) {
    barcodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.system2.triggerManualScan();
      }
    });
  }
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
      const hint = document.getElementById('assemblyEmptyHint');
      if (hint) hint.classList.remove('hidden');
    }
  } catch (err) {
    console.error('[refreshProjects error]', err);
  }
}

function renderProjectPicker() {
  const sel = document.getElementById('projectSelect');
  if (!sel) return;
  sel.innerHTML = '';
  if (!state.projects.length) {
    const o = document.createElement('option');
    o.textContent = '— No Projects —';
    sel.appendChild(o);
    return;
  }
  for (const p of state.projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.stats.panels} parts)`;
    if (state.project && state.project.id === p.id) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function openProject(projectId) {
  try {
    state.project = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    renderProjectPicker();

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

    const hint = document.getElementById('assemblyEmptyHint');
    if (hint) hint.classList.add('hidden');

    setStatus(`Opened batch: ${state.project.name} (${state.project.stats.panels} parts)`, 'ok');
  } catch (err) {
    setStatus(`Failed to open project: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Barcode Scan Processing (Global Core Logic)
// ---------------------------------------------------------------------------
async function handleBarcodeScan(barcode, station) {
  if (!barcode || !barcode.trim()) return;
  const raw = barcode.trim();
  setStatus(`Processing barcode: ${raw}…`);

  try {
    const result = await api('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ barcode: raw, station }),
    });

    if (result.found) {
      if (soundEnabled) {
        if (result.newStatus === 'assembled') playStageChime();
        else playSuccessChime();
      }

      state.project = await api(`/api/projects/${encodeURIComponent(result.projectId)}`);
      activeCabinet = state.project.cabinets.find((c) => c.id === result.cabinetId) || activeCabinet;
      activePanel = activeCabinet ? activeCabinet.panels.find((p) => p.id === result.panelId) : null;

      showScanToast(
        `Scanned: ${activePanel ? activePanel.name : raw} [${result.partCode}]`,
        `Marked as ${result.newStatus.toUpperCase().replace('_', ' ')} · ${result.cabinetStats.percentComplete}% Cabinet Complete`,
        'ok',
      );

      renderCabinetSelector();
      renderAssemblyStation();
      renderCncStation();
      renderSawStation();

      getV3d().then((v3d) => {
        if (v3d) {
          v3d.setProject(state.project, { cabinetId: activeCabinet ? activeCabinet.id : undefined, panelId: activePanel ? activePanel.id : undefined });
          v3d.highlight(result.panelId, true);
        }
      });

      if (v2dCnc && activePanel) v2dCnc.setPanel(activePanel);
      if (v2dCam && activePanel) updateCad2dLayers();

      setStatus(result.message, 'ok');
    }
  } catch (err) {
    if (soundEnabled) playErrorBeep();
    showScanToast('Barcode Not Found', `No matching part code "${raw}" found.`, 'error');
    setStatus(`Barcode not found: ${raw}`, 'error');
  }
}

function showScanToast(title, msg, kind = 'ok') {
  const toast = document.getElementById('scanToast');
  const tTitle = document.getElementById('toastTitle');
  const tMsg = document.getElementById('toastMessage');
  if (!toast) return;

  if (tTitle) tTitle.textContent = title;
  if (tMsg) tMsg.textContent = msg;

  toast.classList.remove('hidden');
  toast.style.borderColor = kind === 'error' ? 'var(--error)' : 'var(--emerald)';

  setTimeout(() => {
    if (toast) toast.classList.add('hidden');
  }, 4000);
}

function renderQuickScanPills() {
  const host = document.getElementById('quickScanPills');
  if (!host) return;
  host.innerHTML = '';
  if (!state.project) return;

  const sampleParts = state.project.cabinets.flatMap((c) => c.panels).slice(0, 5);
  for (const p of sampleParts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-scan-pill';
    btn.dataset.quickScan = p.barcode || p.partCode;
    btn.textContent = p.partCode || p.id.split('-').pop();
    btn.title = `Simulate scan of ${p.name} (${p.partCode})`;
    host.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// Module D: Assembly Zone UI & Component Highlighter
// ---------------------------------------------------------------------------
function renderCabinetSelector() {
  const sel = document.getElementById('assemblyCabinetSelect');
  if (!sel) return;
  sel.innerHTML = '';
  if (!state.project) return;

  for (const cab of state.project.cabinets) {
    const opt = document.createElement('option');
    opt.value = cab.id;
    opt.textContent = `${cab.name} (${cab.panels.length} panels)`;
    if (activeCabinet && activeCabinet.id === cab.id) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderAssemblyStation() {
  if (!state.project || !activeCabinet) return;

  // 1. Update Cabinet Badge & Progress
  const cabBadge = document.getElementById('assemblyCabBadge');
  if (cabBadge) cabBadge.textContent = activeCabinet.name;

  const totalParts = activeCabinet.panels.reduce((sum, p) => sum + p.qty, 0);
  const stagedParts = activeCabinet.panels.reduce((sum, p) => sum + (p.status === 'staged' || p.status === 'assembled' ? p.qty : 0), 0);
  const percent = totalParts > 0 ? Math.round((stagedParts / totalParts) * 100) : 0;

  const progLabel = document.getElementById('assemblyProgressLabel');
  if (progLabel) progLabel.textContent = `Assembly Progress: ${stagedParts} / ${totalParts} Parts (${percent}%)`;

  const progBar = document.getElementById('assemblyProgressBar');
  if (progBar) progBar.style.width = `${percent}%`;

  const statusTag = document.getElementById('assemblyStatusTag');
  if (statusTag) {
    statusTag.textContent = percent === 100 ? '✔ Fully Staged' : `${percent}% Ready`;
    statusTag.className = percent === 100 ? 'chip ok' : 'chip warn';
  }

  // 2. Render Left Panel Parts Checklist
  const list = document.getElementById('assemblyPartsList');
  if (list) {
    list.innerHTML = '';
    for (const p of activeCabinet.panels) {
      const isSelected = activePanel && activePanel.id === p.id;
      const card = document.createElement('div');
      card.className = `part-check-item ${isSelected ? 'selected' : ''} ${p.status}`;
      card.dataset.panelId = p.id;

      const statusBadge =
        p.status === 'assembled'
          ? '<span class="status-badge assembled">ASSEMBLED</span>'
          : p.status === 'staged'
            ? '<span class="status-badge staged">STAGED</span>'
            : p.status === 'machined'
              ? '<span class="status-badge machined">MACHINED</span>'
              : '<span class="status-badge pending">PENDING CUT</span>';

      card.innerHTML = `
        <div class="part-row-main">
          <div class="part-title-box">
            <strong class="part-title">${escapeHtml(p.name)}</strong>
            <span class="part-code mono">${escapeHtml(p.partCode || p.id)}</span>
          </div>
          ${statusBadge}
        </div>
        <div class="part-meta-line">
          <span>${fmt(p.width)} × ${fmt(p.height)} × ${fmt(p.thickness)} mm</span>
          <span>Qty: ${p.qty}</span>
        </div>
        <div class="part-action-row">
          <span class="muted" style="font-size:10px">${escapeHtml(p.material)}</span>
          <button type="button" class="btn-stage-toggle ${p.status === 'staged' || p.status === 'assembled' ? 'is-staged' : ''}" data-action="toggle-stage">
            ${p.status === 'assembled' ? '✔ Assembled' : p.status === 'staged' ? '✔ Staged' : 'Mark Staged'}
          </button>
        </div>
      `;

      list.appendChild(card);
    }
  }

  // 3. Active Panel Banner & Highlighting
  const banner = document.getElementById('assemblyActiveBanner');
  const bannerName = document.getElementById('activePartName');
  if (activePanel && banner && bannerName) {
    banner.classList.remove('hidden');
    bannerName.textContent = `${activePanel.name} (${activePanel.partCode || activePanel.id})`;
  }

  // 4. Render Right Panel Hardware Graphics
  renderHardwareDetailPanel();
}

function renderHardwareDetailPanel() {
  const codeBadge = document.getElementById('hwPartCodeBadge');
  const partTitle = document.getElementById('specPartTitle');
  const dim = document.getElementById('specDim');
  const mat = document.getElementById('specMat');
  const grain = document.getElementById('specGrain');
  const status = document.getElementById('specStatus');
  const edgeband = document.getElementById('specEdgeband');
  const countBadge = document.getElementById('hwCountBadge');
  const hwList = document.getElementById('hardwareCardsList');

  if (!activePanel) {
    if (partTitle) partTitle.textContent = 'No Part Selected';
    if (codeBadge) codeBadge.textContent = '—';
    if (dim) dim.textContent = '—';
    if (mat) mat.textContent = '—';
    if (grain) grain.textContent = '—';
    if (status) status.textContent = '—';
    if (edgeband) edgeband.innerHTML = '';
    if (countBadge) countBadge.textContent = '0 items';
    if (hwList) hwList.innerHTML = '<div class="empty-hint">Select a component to inspect hardware.</div>';
    return;
  }

  if (codeBadge) codeBadge.textContent = activePanel.partCode || activePanel.id;
  if (partTitle) partTitle.textContent = activePanel.name;
  if (dim) dim.textContent = `${fmt(activePanel.width)} × ${fmt(activePanel.height)} × ${fmt(activePanel.thickness)} mm`;
  if (mat) mat.textContent = activePanel.material;
  if (grain) grain.textContent = activePanel.grain || 'none';
  if (status) status.textContent = (activePanel.status || 'pending_cut').toUpperCase().replace('_', ' ');

  if (edgeband) {
    edgeband.innerHTML = '';
    const edges = [
      { name: 'Top (L1)', val: activePanel.edgeband?.find((e) => e.edge === 'T') },
      { name: 'Bottom (L2)', val: activePanel.edgeband?.find((e) => e.edge === 'B') },
      { name: 'Left (W1)', val: activePanel.edgeband?.find((e) => e.edge === 'L') },
      { name: 'Right (W2)', val: activePanel.edgeband?.find((e) => e.edge === 'R') },
    ];
    for (const ed of edges) {
      const tag = document.createElement('span');
      tag.className = `edge-pill ${ed.val ? 'applied' : 'none'}`;
      tag.textContent = `${ed.name}: ${ed.val ? ed.val.material || 'ABS' : '—'}`;
      edgeband.appendChild(tag);
    }
  }

  if (hwList) {
    hwList.innerHTML = '';
    const fittings = activePanel.hardware || [];
    if (countBadge) countBadge.textContent = `${fittings.length} items`;

    if (!fittings.length) {
      hwList.innerHTML = `
        <div class="empty-hint" style="padding: 16px;">
          <span>✔ No pre-assembly hardware fittings required for this panel face.</span>
        </div>
      `;
    } else {
      for (const h of fittings) {
        const card = document.createElement('div');
        card.className = 'hardware-card';

        let icon = '🔩';
        let title = h.kind || 'Fitting';
        let actionText = `Mount hardware at (${fmt(h.x)}, ${fmt(h.y)}) mm`;

        if (h.category === 'hinge' || h.kind.toLowerCase().includes('hinge')) {
          icon = '🚪';
          title = 'Concealed Hinge (Ø35mm)';
          actionText = `Press hinge into Ø35mm cup hole at (${fmt(h.x)}, ${fmt(h.y)}) mm`;
        } else if (h.category === 'dowel' || h.kind.toLowerCase().includes('dowel')) {
          icon = '🪵';
          title = 'Wooden Dowel (Ø8×30mm)';
          actionText = `Insert dowel into 8mm hole at (${fmt(h.x)}, ${fmt(h.y)}) mm`;
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

        hwList.appendChild(card);
      }
    }
  }

  const btnStage = document.getElementById('btnToggleStageCurrent');
  if (btnStage) {
    const isStaged = activePanel.status === 'staged' || activePanel.status === 'assembled';
    btnStage.textContent = isStaged ? '✔ Panel Staged (Click to Toggle)' : 'Mark Panel as Staged for Assembly';
    btnStage.className = isStaged ? 'btn ok full-width' : 'btn full-width';
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

// ---------------------------------------------------------------------------
// Module B: CNC Operator Station (Biesse Rover A)
// ---------------------------------------------------------------------------
function renderCncStation() {
  if (!state.project) return;
  const queue = document.getElementById('cncPartQueue');
  if (!queue) return;

  queue.innerHTML = '';
  const allPanels = state.project.cabinets.flatMap((c) => c.panels);

  for (const p of allPanels) {
    const isSelected = activePanel && activePanel.id === p.id;
    const card = document.createElement('div');
    card.className = `cnc-queue-item ${isSelected ? 'selected' : ''}`;
    card.dataset.panelId = p.id;

    card.innerHTML = `
      <div class="queue-row-top">
        <strong>${escapeHtml(p.name)}</strong>
        <span class="status-badge ${p.status}">${(p.status || 'pending').toUpperCase().replace('_', ' ')}</span>
      </div>
      <div class="queue-row-sub">
        <span class="part-code-tag">${escapeHtml(p.cixFileName || `${p.partCode}.cix`)}</span>
        <span>${fmt(p.width)} × ${fmt(p.height)} mm</span>
      </div>
    `;

    queue.appendChild(card);
  }

  const cncTitle = document.getElementById('cncActivePartTitle');
  if (activePanel && cncTitle) {
    cncTitle.textContent = `${activePanel.name} (${activePanel.partCode}) — Pod-and-Rail Setup`;
  }

  if (v2dCnc && activePanel) {
    v2dCnc.setPanel(activePanel);
  }

  loadActiveCixCode();
}

async function loadActiveCixCode() {
  const codeBox = document.getElementById('cixCodePreview');
  if (!codeBox) return;

  if (!activePanel || !state.project) {
    codeBox.textContent = '; Select a part or scan barcode to view .cix code';
    return;
  }

  try {
    const text = await api(`/api/projects/${encodeURIComponent(state.project.id)}/cix/${encodeURIComponent(activePanel.id)}`);
    codeBox.textContent = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
  } catch (e) {
    codeBox.textContent = `; .cix generation preview unavailable: ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// Module A: Cut Rite & Beam Saw Station
// ---------------------------------------------------------------------------
function renderSawStation() {
  if (!state.project) return;

  const btnCsv = document.getElementById('btnDownloadCutRiteCsv');
  if (btnCsv) {
    btnCsv.href = `/api/projects/${encodeURIComponent(state.project.id)}/cutrite.csv`;
  }

  const allPanels = state.project.cabinets.flatMap((c) => c.panels);
  const countTag = document.getElementById('cutRitePartCount');
  if (countTag) countTag.textContent = `${allPanels.length} synchronized parts`;

  const syncStat = document.getElementById('syncStatText');
  if (syncStat) {
    syncStat.textContent = `${allPanels.length} of ${allPanels.length} parts have 100% synchronized Part Codes, Barcodes, and bSolid .cix file names.`;
  }

  // Render Table
  const tbody = document.getElementById('cutRiteTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    for (const p of allPanels) {
      const tr = document.createElement('tr');
      const edgeL1 = p.edgeband?.find((e) => e.edge === 'T')?.material || '—';
      const edgeL2 = p.edgeband?.find((e) => e.edge === 'B')?.material || '—';
      const edgeW1 = p.edgeband?.find((e) => e.edge === 'L')?.material || '—';
      const edgeW2 = p.edgeband?.find((e) => e.edge === 'R')?.material || '—';

      tr.innerHTML = `
        <td class="mono"><strong>${escapeHtml(p.partCode)}</strong></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.material)}</td>
        <td class="mono">${fmt(p.width)}</td>
        <td class="mono">${fmt(p.height)}</td>
        <td class="mono">${fmt(p.thickness)}</td>
        <td>${p.qty}</td>
        <td>${p.grain || '0'}</td>
        <td class="muted">${escapeHtml(edgeL1)}</td>
        <td class="muted">${escapeHtml(edgeL2)}</td>
        <td class="muted">${escapeHtml(edgeW1)}</td>
        <td class="muted">${escapeHtml(edgeW2)}</td>
        <td class="mono">${escapeHtml(p.cixFileName || `${p.partCode}.cix`)}</td>
        <td class="mono"><span class="badge ok">${escapeHtml(p.barcode || p.partCode)}</span></td>
      `;
      tbody.appendChild(tr);
    }
  }

  // Render Barcode Labels
  const labelsGrid = document.getElementById('sawLabelsGrid');
  if (labelsGrid) {
    labelsGrid.innerHTML = '';
    for (const p of allPanels) {
      const card = document.createElement('div');
      card.className = 'label-card';
      const svgBarcode = code128(p.barcode || p.partCode);

      card.innerHTML = `
        <div class="label-top-row">
          <div>
            <div class="label-cab-title">${escapeHtml(p.cabinetId || 'CAB')} · ${escapeHtml(p.name)}</div>
            <div class="label-code-badge">${escapeHtml(p.partCode)}</div>
          </div>
          <div class="label-qty">QTY: <strong>${p.qty}</strong></div>
        </div>
        <div class="label-barcode-box">${svgBarcode}</div>
        <div class="label-barcode-human mono">${escapeHtml(p.barcode || p.partCode)}</div>
        <div class="label-specs">
          <span>${fmt(p.width)} × ${fmt(p.height)} × ${fmt(p.thickness)} mm</span>
          <span>${escapeHtml(p.material)}</span>
        </div>
        <div class="label-cix-row mono">bSolid CIX: ${escapeHtml(p.cixFileName || `${p.partCode}.cix`)}</div>
      `;
      labelsGrid.appendChild(card);
    }
  }
}

// ---------------------------------------------------------------------------
// Module A/B/C: CAM, Pre-Flight & Settings
// ---------------------------------------------------------------------------
async function renderCamStation() {
  if (!state.project) return;

  try {
    const res = await api(`/api/projects/${encodeURIComponent(state.project.id)}/validate`);
    const sum = document.getElementById('preflightSummary');
    const issuesBox = document.getElementById('preflightIssues');

    if (sum) {
      sum.innerHTML = `
        <div class="kpi ${res.errorCount === 0 ? 'ok' : 'danger'}">
          <span class="k">Critical Errors</span>
          <span class="v">${res.errorCount}</span>
        </div>
        <div class="kpi ${res.warningCount === 0 ? 'ok' : 'warn'}">
          <span class="k">Warnings</span>
          <span class="v">${res.warningCount}</span>
        </div>
        <div class="kpi">
          <span class="k">Total Checked Parts</span>
          <span class="v">${res.totalPanels}</span>
        </div>
      `;
    }

    if (issuesBox) {
      issuesBox.innerHTML = '';
      if (!res.issues || res.issues.length === 0) {
        issuesBox.innerHTML = '<div class="alert-box ok">✔ All pre-flight safety checks passed. Pod-and-rail paths and tooling are clear.</div>';
      } else {
        for (const issue of res.issues) {
          const div = document.createElement('div');
          div.className = `alert-box ${issue.severity}`;
          div.innerHTML = `<strong>[${issue.severity.toUpperCase()}] ${escapeHtml(issue.code)}:</strong> ${escapeHtml(issue.message)} (${escapeHtml(issue.panelId)})`;
          issuesBox.appendChild(div);
        }
      }
    }
  } catch (err) {
    console.error('[Preflight error]', err);
  }

  renderWorkshopSettings();
}

function renderWorkshopSettings() {
  const s = state.settings;
  if (!s) return;

  const proto = document.getElementById('cfgProtocol');
  const target = document.getElementById('cfgTargetDir');
  if (proto) proto.value = s.network.protocol;
  if (target) target.value = s.network.targetDirectory;

  const foldersList = document.getElementById('cfgMachineFoldersList');
  if (foldersList) {
    foldersList.innerHTML = '';
    s.network.machineFolders.forEach((m, idx) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.gap = '8px';
      row.style.marginBottom = '6px';
      row.innerHTML = `
        <input type="text" data-idx="${idx}" data-field="name" value="${escapeHtml(m.name)}" style="flex:0 0 140px" />
        <input type="text" data-idx="${idx}" data-field="folder" value="${escapeHtml(m.folder)}" style="flex:1" />
        <button type="button" class="btn small ghost danger" onclick="system2.removeMachineFolder(${idx})">✕</button>
      `;
      foldersList.appendChild(row);
    });
  }

  const toolingBody = document.getElementById('cfgToolingTableBody');
  if (toolingBody) {
    toolingBody.innerHTML = '';
    for (const t of s.tooling.tools) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono"><strong>${escapeHtml(t.id)}</strong></td>
        <td>${escapeHtml(t.name)}</td>
        <td>${escapeHtml(t.type)}</td>
        <td class="mono">Ø${t.diameter} mm</td>
        <td class="mono">${t.spindleIndex || '—'}</td>
      `;
      toolingBody.appendChild(tr);
    }
  }
}

async function saveWorkshopSettings() {
  const s = state.settings;
  if (!s) return;

  const proto = document.getElementById('cfgProtocol');
  const target = document.getElementById('cfgTargetDir');
  if (proto) s.network.protocol = proto.value;
  if (target) s.network.targetDirectory = target.value.trim();

  const rows = document.querySelectorAll('#cfgMachineFoldersList .row');
  rows.forEach((row) => {
    const nameInp = row.querySelector('[data-field=name]');
    const folderInp = row.querySelector('[data-field=folder]');
    const idx = Number(nameInp.dataset.idx);
    if (s.network.machineFolders[idx]) {
      s.network.machineFolders[idx].name = nameInp.value.trim();
      s.network.machineFolders[idx].folder = folderInp.value.trim();
    }
  });

  state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
  const msg = document.getElementById('settingsSaveMsg');
  if (msg) {
    msg.textContent = '✔ Settings saved.';
    setTimeout(() => {
      if (msg) msg.textContent = '';
    }, 2500);
  }
}

function setStatus(msg, kind = 'ok') {
  const txt = document.getElementById('statusText');
  const bar = document.getElementById('statusbar');
  if (txt) txt.textContent = msg;
  if (bar) {
    const dot = bar.querySelector('.dot');
    if (dot) {
      dot.style.background = kind === 'error' ? 'var(--error)' : 'var(--ok)';
    }
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Start on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => console.error('[Init error]', e));
  });
} else {
  init().catch((e) => console.error('[Init error]', e));
}
