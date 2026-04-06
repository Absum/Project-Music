import type { SpeciesPreset } from '../types/index.js';

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
    reproductionCost: 35, // cheap to reproduce, but average efficiency — the generalist
    energyEfficiency: 1.0,
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
    reproductionCost: 30, // breeds fastest, but burns resources — the swarm
    energyEfficiency: 0.7,
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
    reproductionCost: 48, // efficient but slow to reproduce — the tank
    energyEfficiency: 1.2,
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
    reproductionCost: 40, // balanced with slightly better efficiency — the survivor
    energyEfficiency: 1.1,
  },
];
