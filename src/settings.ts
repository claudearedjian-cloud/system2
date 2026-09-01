/**
 * Workshop configuration: tooling mapping, network distribution targets and
 * costing parameters.  Persisted to data/settings.json by the backend.
 */
import type { Settings } from '../shared/types.js';

export const DEFAULT_SETTINGS: Settings = {
  tooling: {
    routerDiameter: 12,
    tools: [
      { id: 'R1', name: 'Main router 12mm', type: 'router', diameter: 12, spindle: 1 },
      { id: 'R2', name: 'Finishing router 6mm', type: 'router', diameter: 6, spindle: 2 },
      { id: 'B5', name: 'Boring block 5mm', type: 'boring-block', diameter: 5, spindle: 3 },
      { id: 'B8', name: 'Boring block 8mm', type: 'boring-block', diameter: 8, spindle: 3 },
      { id: 'B35', name: 'Boring block 35mm (hinge)', type: 'boring-block', diameter: 35, spindle: 4 },
      { id: 'A90', name: 'Horizontal aggregate', type: 'aggregate', diameter: 8, spindle: 5 },
    ],
  },
  network: {
    enabled: true,
    protocol: 'local',
    targetDir: '',
    machineFolders: [
      { name: 'Biesse Rover A', folder: 'rover-a' },
      { name: 'Nesting station', folder: 'nesting' },
    ],
  },
  costs: {
    currency: 'USD',
    boardSize: [2800, 2070],
    wastePercent: 15,
    costPerSqm: {
      '18mm Melamine White': 42,
      '18mm Melamine Beech': 44,
      '18mm MDF': 38,
      '16mm Melamine White': 38,
      Unknown: 35,
    },
    edgebandPerMeter: 0.9,
  },
};
