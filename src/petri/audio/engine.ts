import type { GridState, SimulationEvent, CollisionConfig, MelodyConfig, NoteDuration } from '../types.js';
import type { AudioBus } from '../../audio/bus.js';
import { buildPitchMap } from './scales.js';
import * as Tone from 'tone';

const SPECIES_TO_PRESET = [1, 2, 0, 3]; // Oscillaris→PAD, Sawtonis→LEAD, Quadrus→BASS, Triangula→ARP

const DEFAULT_MELODY_CONFIG: MelodyConfig = {
  rootNote: 'C', scaleType: 'minorPentatonic',
  octaveLow: 2, octaveHigh: 5,
  speciesDuration: ['4n', '8n', '8n', '16n'],
  kickDensity: 2, kickPitch: 'C2',
  maxNotesPerSpecies: 1, masterVolume: -7,
};

export class AudioEngine {
  private bus: AudioBus;

  // Collision noise (not a preset — separate sound)
  private noiseSynth!: Tone.NoiseSynth;
  private noisePanner!: Tone.Panner;
  private noiseFilter!: Tone.Filter;
  private lastNoiseType = 'pink';
  private lastCollisionTime = 0;

  // Playhead
  private _playheadCol = 0;
  private initialized = false;

  // Melody config
  private melodyConfig: MelodyConfig = { ...DEFAULT_MELODY_CONFIG, speciesDuration: [...DEFAULT_MELODY_CONFIG.speciesDuration] };
  private pitchMap: string[] = buildPitchMap('C', 'minorPentatonic', 2, 5, 32);

  get playheadCol(): number { return this._playheadCol; }

  constructor(bus: AudioBus) {
    this.bus = bus;
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    // Collision noise — not a preset, connects directly to destination
    this.noisePanner = new Tone.Panner(0);
    this.noiseFilter = new Tone.Filter(4000, 'lowpass');
    this.noiseSynth = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
      volume: -26,
    });
    this.noiseSynth.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noisePanner);
    this.noisePanner.toDestination();

    this.initialized = true;
  }

  setMelodyConfig(config: MelodyConfig): void {
    this.melodyConfig = config;
    this.pitchMap = buildPitchMap(config.rootNote, config.scaleType, config.octaveLow, config.octaveHigh, 32);
  }

  syncCollisionConfig(c: CollisionConfig): void {
    if (!this.initialized) return;
    if (c.noiseType !== this.lastNoiseType) {
      this.lastNoiseType = c.noiseType;
      this.noiseSynth.disconnect();
      this.noiseSynth.dispose();
      this.noiseSynth = new Tone.NoiseSynth({
        noise: { type: c.noiseType },
        envelope: { attack: c.attack, decay: c.decay, sustain: 0, release: c.decay * 0.5 },
        volume: c.volume,
      });
      this.noiseSynth.connect(this.noiseFilter);
    } else {
      this.noiseSynth.volume.rampTo(c.volume, 0.1);
      const env = this.noiseSynth.envelope as unknown as Record<string, unknown>;
      env.attack = c.attack; env.decay = c.decay; env.release = c.decay * 0.5;
    }
    this.noiseFilter.frequency.rampTo(c.filterCutoff, 0.1);
  }

  processEvents(events: SimulationEvent[], gridWidth: number): void {
    if (!this.initialized) return;
    let collisions = 0;
    for (const event of events) {
      if (event.type === 'collision' && collisions < 1) {
        collisions++;
        this.noisePanner.pan.rampTo((event.x / gridWidth) * 2 - 1, 0.01);
        const now = Tone.now();
        const startTime = Math.max(now, this.lastCollisionTime + 0.2);
        this.noiseSynth.triggerAttackRelease('32n', startTime);
        this.lastCollisionTime = startTime;
      }
    }
  }

  updateOrganisms(grid: GridState): void {
    if (!this.initialized) return;

    const col = this._playheadCol;
    const gw = grid.width;

    // Scan current column
    const hits: { species: number; row: number; energy: number }[] = [];
    for (let y = 0; y < grid.height; y++) {
      const cell = grid.cells[y][col];
      if (cell.organism) hits.push({ species: cell.organism.species, row: y, energy: cell.organism.energy });
    }

    // Kick
    let totalOrgs = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < gw; x++) { if (grid.cells[y][x].organism) totalOrgs++; }
    }
    if (totalOrgs > 0 && col % this.melodyConfig.kickDensity === 0) {
      this.bus.play(4, this.melodyConfig.kickPitch, '8n');
    }

    // Spatial panning from species centroid
    const gh = grid.height;
    for (let s = 0; s < 4; s++) {
      let cx = 0, count = 0;
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const org = grid.cells[y][x].organism;
          if (org && org.species === s) { cx += x; count++; }
        }
      }
      if (count > 0) {
        const pan = (cx / count / gw) * 2 - 1;
        this.bus.setChannelPan(SPECIES_TO_PRESET[s], pan);
      }
    }

    // Play notes
    if (hits.length > 0) {
      const bySpecies: Map<number, { row: number; energy: number }[]> = new Map();
      for (const hit of hits) {
        const list = bySpecies.get(hit.species) || [];
        list.push(hit);
        bySpecies.set(hit.species, list);
      }

      for (const [species, orgHits] of bySpecies) {
        const presetIdx = SPECIES_TO_PRESET[species];
        const sorted = orgHits.sort((a, b) => b.energy - a.energy).slice(0, this.melodyConfig.maxNotesPerSpecies);
        for (const hit of sorted) {
          const pitch = this.rowToPitch(hit.row, grid.height);
          const duration = this.melodyConfig.speciesDuration[species] as NoteDuration;
          this.bus.play(presetIdx, pitch, duration);
        }
      }
    }

    this._playheadCol = (col + 1) % gw;
  }

  private rowToPitch(row: number, gridHeight: number): string {
    const index = Math.floor((row / gridHeight) * this.pitchMap.length);
    return this.pitchMap[Math.min(index, this.pitchMap.length - 1)];
  }

  dispose(): void {
    this.noiseSynth?.dispose();
    this.noiseFilter?.dispose();
    this.noisePanner?.dispose();
  }
}
