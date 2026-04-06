import type { SpeciesPreset } from '../types.js';

export const SPECIES_PRESETS: SpeciesPreset[] = [
  {
    name: 'Oscillaris',
    color: '#44dd88',
    params: {
      waveform: 'sine',
      frequency: 220,
      filterCutoff: 2000,
      attack: 0.05,
      decay: 0.2,
      sustain: 0.6,
      release: 0.4,
    },
    reproductionCost: 33, // generalist — balanced
    energyEfficiency: 1.05,
  },
  {
    name: 'Sawtonis',
    color: '#dd4488',
    params: {
      waveform: 'sawtooth',
      frequency: 330,
      filterCutoff: 3000,
      attack: 0.01,
      decay: 0.1,
      sustain: 0.4,
      release: 0.2,
    },
    reproductionCost: 32, // fast breeder but resource hungry
    energyEfficiency: 0.8,
  },
  {
    name: 'Quadrus',
    color: '#4488dd',
    params: {
      waveform: 'square',
      frequency: 165,
      filterCutoff: 1500,
      attack: 0.02,
      decay: 0.15,
      sustain: 0.7,
      release: 0.3,
    },
    reproductionCost: 35, // efficient and steady
    energyEfficiency: 1.3,
  },
  {
    name: 'Triangula',
    color: '#ddaa44',
    params: {
      waveform: 'triangle',
      frequency: 440,
      filterCutoff: 4000,
      attack: 0.08,
      decay: 0.3,
      sustain: 0.5,
      release: 0.6,
    },
    reproductionCost: 33, // balanced survivor
    energyEfficiency: 1.1,
  },
];
