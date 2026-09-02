/**
 * Pre-flight validation engine (Module B).
 *
 * Runs a deterministic safety pass over the whole batch before any .cix code
 * is written. Errors block compilation; warnings are reported but allowed.
 */
import type { Panel, Project, ValidationIssue, ValidationReport } from '../shared/types.js';

export function validateProject(project: Project): ValidationReport {
  const issues: ValidationIssue[] = [];
  const panels = project.cabinets.flatMap((c) => c.panels);

  for (const panel of panels) {
    const bbW = panel.width;
    const bbH = panel.height;

    // Missing physical data
    if (!panel.thickness || panel.thickness <= 0) {
      issues.push({ severity: 'error', code: 'NO_THICKNESS', panelId: panel.id, message: `Missing material thickness` });
    }
    if (!panel.width || !panel.height || panel.width <= 0 || panel.height <= 0) {
      issues.push({ severity: 'error', code: 'NO_SIZE', panelId: panel.id, message: `Missing finished dimensions` });
    }
    if (!panel.material || panel.material === 'Unknown') {
      issues.push({ severity: 'warning', code: 'UNKNOWN_MATERIAL', panelId: panel.id, message: `Material is unknown — verify against cutting list` });
    }

    // Pod-and-Rail clamping check
    if (panel.width < 70 || panel.height < 70) {
      issues.push({ severity: 'warning', code: 'SMALL_PART_POD_CLAMP', panelId: panel.id, message: `Part (${panel.width}x${panel.height}mm) is narrow — verify pod-and-rail vacuum cup placement` });
    }

    // Naming & Barcode synchronization check
    if (!panel.partCode || !/^[A-Za-z0-9_-]+$/.test(panel.partCode)) {
      issues.push({ severity: 'error', code: 'INVALID_PART_CODE', panelId: panel.id, message: `Part code "${panel.partCode}" contains invalid characters for bSolid/Cut Rite synchronization` });
    }

    // Drill-hole checks
    for (const d of panel.drillings) {
      const diameter = d.diameter || 0;
      const depth = d.depth || 0;

      if (d.x < -0.5 || d.y < -0.5 || d.x > bbW + 0.5 || d.y > bbH + 0.5) {
        issues.push({ severity: 'error', code: 'HOLE_OFF_PANEL', panelId: panel.id, message: `Drill hole ${d.id} at (${d.x}, ${d.y}) is outside the panel bounds (${bbW}x${bbH})` });
      }
      if (diameter <= 0) {
        issues.push({ severity: 'error', code: 'HOLE_NO_DIAMETER', panelId: panel.id, message: `Drill hole ${d.id} has no diameter` });
      }
      if (d.face !== 'edge' && depth > panel.thickness * 1.05) {
        issues.push({ severity: 'error', code: 'HOLE_TOO_DEEP', panelId: panel.id, message: `Drill hole ${d.id} depth ${depth}mm exceeds panel thickness ${panel.thickness}mm` });
      }
      if (d.face !== 'edge' && depth > panel.thickness * 0.95) {
        issues.push({ severity: 'warning', code: 'HOLE_THROUGH', panelId: panel.id, message: `Drill hole ${d.id} penetrates through the panel (${depth}/${panel.thickness}mm)` });
      }
    }

    // Overlapping holes (same face)
    const drills = panel.drillings;
    for (let i = 0; i < drills.length; i++) {
      for (let j = i + 1; j < drills.length; j++) {
        const a = drills[i];
        const b = drills[j];
        if (a.face !== b.face) continue;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const minDist = ((a.diameter || 0) + (b.diameter || 0)) / 2;
        if (dist < minDist && dist < 0.5) {
          issues.push({ severity: 'error', code: 'HOLE_OVERLAP', panelId: panel.id, message: `Drill holes ${a.id} and ${b.id} overlap at (${a.x},${a.y})` });
        }
      }
    }

    // Groove sanity
    for (const g of panel.grooves) {
      if (g.depth > panel.thickness) {
        issues.push({ severity: 'error', code: 'GROOVE_TOO_DEEP', panelId: panel.id, message: `Groove ${g.id} depth ${g.depth}mm exceeds panel thickness ${panel.thickness}mm` });
      }
    }
  }

  // Batch-level: duplicate part IDs or part codes
  const seen = new Map<string, number>();
  for (const p of panels) {
    const key = p.partCode || p.id;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) {
      issues.push({ severity: 'error', code: 'DUPLICATE_ID', panelId: id, message: `Part Code ${id} appears ${count} times in the batch` });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.length - errorCount;

  return { ok: errorCount === 0, errorCount, warningCount, issues };
}
