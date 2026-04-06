export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface OrganismParams {
  waveform: Waveform;
  frequency: number;
  filterCutoff: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface Organism {
  id: number;
  species: number;
  age: number;
  energy: number;
  maxEnergy: number;
  params: OrganismParams;
  x: number;
  y: number;
  birthTick: number;
}

export interface Cell {
  organism: Organism | null;
  resources: number;
  maxResources: number;
  wall: boolean;
}

export interface GridState {
  width: number;
  height: number;
  cells: Cell[][];
  tick: number;
}

export interface SimulationConfig {
  bpm: number;
  mutationRate: number;
  resourceRegenRate: number;
  reproductionThreshold: number;
  maxOrganisms: number;
  gravity: { x: number; y: number } | null;
}

export interface SimulationEvent {
  type: 'birth' | 'death' | 'collision';
  x: number;
  y: number;
  organism: Organism;
  opponent?: Organism;
  tick: number;
}

export interface SpeciesPreset {
  name: string;
  color: string;
  params: OrganismParams;
  reproductionCost: number;
  energyEfficiency: number;
}
