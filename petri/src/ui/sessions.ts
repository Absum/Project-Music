import type { GridState, SimulationConfig } from '../types/index.js';
import { createGrid, spawnOrganism } from '../simulation/grid.js';

const STORAGE_KEY = 'petri_snapshots';
const MAX_SNAPSHOTS = 10;

interface Snapshot {
  name: string;
  timestamp: number;
  data: SerializedState;
}

interface SerializedState {
  width: number;
  height: number;
  organisms: { x: number; y: number; species: number; energy: number }[];
  walls: { x: number; y: number }[];
  config: Partial<SimulationConfig>;
}

// --- Snapshot system (localStorage) ---

export function saveSnapshot(name: string, grid: GridState, config: SimulationConfig): void {
  const data = serializeState(grid, config);
  const snapshots = loadSnapshots();
  snapshots.unshift({ name, timestamp: Date.now(), data });
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
}

export function loadSnapshots(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

export function restoreSnapshot(snapshot: Snapshot, config: SimulationConfig): GridState {
  return deserializeState(snapshot.data, config);
}

export function deleteSnapshot(index: number): void {
  const snapshots = loadSnapshots();
  snapshots.splice(index, 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
}

// --- Starter presets ---

export interface Preset {
  name: string;
  symbol: string;
  apply: (config: SimulationConfig) => GridState;
}

export const PRESETS: Preset[] = [
  {
    name: 'Genesis',
    symbol: '\u2727',
    apply: (config) => {
      config.bpm = 60;
      config.mutationRate = 0.15;
      config.resourceRegenRate = 2.5;
      config.gravity = null;
      const grid = createGrid(32, 32);
      // Sparse sine organisms in the center — ambient
      const cx = 16;
      for (const [dx, dy] of [[0, 0], [-3, 2], [2, -3], [-2, -2], [3, 3]]) {
        spawnOrganism(grid, cx + dx, cx + dy, 0); // Oscillaris (sine)
      }
      spawnOrganism(grid, 10, 10, 3); // lone Triangula
      spawnOrganism(grid, 22, 22, 3);
      return grid;
    },
  },
  {
    name: 'Warzone',
    symbol: '\u2694',
    apply: (config) => {
      config.bpm = 200;
      config.mutationRate = 0.6;
      config.resourceRegenRate = 1.0;
      config.gravity = null;
      const grid = createGrid(32, 32);
      // Dense, all species competing
      for (let i = 0; i < 40; i++) {
        const x = 4 + Math.floor(Math.random() * 24);
        const y = 4 + Math.floor(Math.random() * 24);
        spawnOrganism(grid, x, y, Math.floor(Math.random() * 4));
      }
      return grid;
    },
  },
  {
    name: 'Symbiosis',
    symbol: '\u262F',
    apply: (config) => {
      config.bpm = 100;
      config.mutationRate = 0.2;
      config.resourceRegenRate = 2.0;
      config.gravity = null;
      const grid = createGrid(32, 32);
      // Two harmonically complementary species (sine 220Hz + triangle 440Hz)
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const r = 6;
        const x = 16 + Math.round(Math.cos(angle) * r);
        const y = 16 + Math.round(Math.sin(angle) * r);
        spawnOrganism(grid, x, y, i % 2 === 0 ? 0 : 3); // alternating sine/triangle
      }
      // Inner ring
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + 0.3;
        const x = 16 + Math.round(Math.cos(angle) * 3);
        const y = 16 + Math.round(Math.sin(angle) * 3);
        spawnOrganism(grid, x, y, i % 2 === 0 ? 3 : 0);
      }
      return grid;
    },
  },
  {
    name: 'Plague',
    symbol: '\u2623',
    apply: (config) => {
      config.bpm = 140;
      config.mutationRate = 0.1;
      config.resourceRegenRate = 1.2;
      config.gravity = null;
      const grid = createGrid(32, 32);
      // One dominant species (square) with a few prey organisms
      for (let i = 0; i < 20; i++) {
        const x = 8 + Math.floor(Math.random() * 16);
        const y = 8 + Math.floor(Math.random() * 16);
        spawnOrganism(grid, x, y, 2); // Quadrus (square)
      }
      // A few stragglers from other species
      spawnOrganism(grid, 5, 5, 0);
      spawnOrganism(grid, 27, 5, 1);
      spawnOrganism(grid, 5, 27, 3);
      spawnOrganism(grid, 27, 27, 0);
      return grid;
    },
  },
];

// --- Share via URL ---

export function encodeToURL(grid: GridState, config: SimulationConfig): string {
  const state = serializeState(grid, config);
  const json = JSON.stringify(state);
  const encoded = btoa(encodeURIComponent(json));
  return `${window.location.origin}${window.location.pathname}#state=${encoded}`;
}

export function decodeFromURL(config: SimulationConfig): GridState | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#state=')) return null;
  try {
    const encoded = hash.slice(7);
    const json = decodeURIComponent(atob(encoded));
    const state: SerializedState = JSON.parse(json);
    return deserializeState(state, config);
  } catch {
    return null;
  }
}

// --- Audio recording ---

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recording = false;

  isRecording(): boolean { return this.recording; }

  start(): boolean {
    const ctx = (globalThis as Record<string, unknown>).Tone
      ? ((globalThis as Record<string, unknown>).Tone as { getContext: () => { rawContext: AudioContext } }).getContext().rawContext
      : null;
    if (!ctx) return false;

    const dest = ctx.createMediaStreamDestination();
    const source = ctx.createGain();
    source.connect(ctx.destination);
    source.connect(dest);

    // Reconnect Tone's master to our gain node
    // This is a simplified approach — we tap the destination directly
    try {
      const stream = dest.stream;
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      this.chunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `petri-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };

      this.mediaRecorder.start();
      this.recording = true;
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    if (this.mediaRecorder && this.recording) {
      this.mediaRecorder.stop();
      this.recording = false;
    }
  }
}

// --- Serialization helpers ---

function serializeState(grid: GridState, config: SimulationConfig): SerializedState {
  const organisms: SerializedState['organisms'] = [];
  const walls: SerializedState['walls'] = [];

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.cells[y][x];
      if (cell.organism) {
        organisms.push({ x, y, species: cell.organism.species, energy: cell.organism.energy });
      }
      if (cell.wall) {
        walls.push({ x, y });
      }
    }
  }

  return {
    width: grid.width,
    height: grid.height,
    organisms,
    walls,
    config: { bpm: config.bpm, mutationRate: config.mutationRate, resourceRegenRate: config.resourceRegenRate },
  };
}

function deserializeState(state: SerializedState, config: SimulationConfig): GridState {
  if (state.config.bpm !== undefined) config.bpm = state.config.bpm;
  if (state.config.mutationRate !== undefined) config.mutationRate = state.config.mutationRate;
  if (state.config.resourceRegenRate !== undefined) config.resourceRegenRate = state.config.resourceRegenRate;

  const grid = createGrid(state.width, state.height);

  for (const w of state.walls) {
    if (w.x >= 0 && w.x < grid.width && w.y >= 0 && w.y < grid.height) {
      grid.cells[w.y][w.x].wall = true;
    }
  }

  for (const o of state.organisms) {
    const org = spawnOrganism(grid, o.x, o.y, o.species);
    if (org) org.energy = o.energy;
  }

  return grid;
}
