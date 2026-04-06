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

export interface CollisionConfig {
  noiseType: 'white' | 'pink' | 'brown';
  volume: number;
  attack: number;
  decay: number;
  filterCutoff: number;
}

export interface SimulationConfig {
  bpm: number;
  mutationRate: number;
  resourceRegenRate: number;
  reproductionThreshold: number;
  maxOrganisms: number;
  gravity: { x: number; y: number } | null;
  collision: CollisionConfig;
  autoSpawn: boolean;
  reproductionProbability: number;
  gracePeriodTicks: number;
}

// Melody configuration
export type ScaleType = 'minorPentatonic' | 'majorPentatonic' | 'minor' | 'major'
  | 'chromatic' | 'blues' | 'dorian' | 'mixolydian' | 'phrygian' | 'harmonicMinor';

export type RootNote = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type NoteDuration = '16n' | '8n' | '4n' | '2n' | '1n';

export type KickDensity = 1 | 2 | 4;

export interface MelodyConfig {
  rootNote: RootNote;
  scaleType: ScaleType;
  octaveLow: number;
  octaveHigh: number;
  speciesDuration: [NoteDuration, NoteDuration, NoteDuration, NoteDuration];
  kickDensity: KickDensity;
  kickPitch: string;
  maxNotesPerSpecies: number;
  masterVolume: number;
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
