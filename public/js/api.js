// Thin API client + shared app state.

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const state = {
  projects: [],
  project: null,
  panelId: null,
  cabinetId: null,
  mode: '2d',
  settings: null,
};

export const DRILL_COLORS = {
  top: '#f5a623',
  bottom: '#a78bfa',
  edge: '#38bdf8',
};

export const MATERIAL_COLORS = {
  '18mm Melamine White': '#e8e4da',
  '18mm Melamine Beech': '#d9b98c',
  '16mm Melamine White': '#e2ded4',
  '18mm MDF': '#d6c9a8',
  '8mm MDF': '#cbbd9c',
  Unknown: '#9aa7b0',
};

export function materialColor(name) {
  if (MATERIAL_COLORS[name]) return MATERIAL_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 45%, 78%)`;
}

export function fmt(n, digits = 1) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
