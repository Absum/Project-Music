import type { GridState, SimulationEvent, CollisionConfig } from '../types.js';
import type { AudioBus } from '../../audio/bus.js';
import type { MelodyEngine } from '../../audio/melody.js';
import * as Tone from 'tone';

const SPECIES_TO_PRESET = [1, 2, 0, 3]; // Oscillaris→PAD, Sawtonis→LEAD, Quadrus→BASS, Triangula→ARP

export class AudioEngine {
  private bus: AudioBus;
  private melody: MelodyEngine;

  // Collision noise (not a preset — separate sound)
  private noiseSynth!: Tone.NoiseSynth;
  private noisePanner!: Tone.Panner;
  private noiseFilter!: Tone.Filter;
  private lastNoiseType = 'pink';
  private lastCollisionTime = 0;

  // Playhead
  private _playheadCol = 0;
  private initialized = false;
  private pitchMap: string[] = [];

  get playheadCol(): number { return this._playheadCol; }

  constructor(bus: AudioBus, melody: MelodyEngine) {
    this.bus = bus;
    this.melody = melody;
    this.rebuildPitchMap();
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

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

  rebuildPitchMap(): void {
    this.pitchMap = this.melody.buildPitchMap(32);
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
    const config = this.melody.getConfig();

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
    if (totalOrgs > 0 && col % this.melody.getKickDensity() === 0) {
      this.bus.play(4, this.melody.getKickPitch(), '8n');
    }

    // Spatial panning
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
        this.bus.setChannelPan(SPECIES_TO_PRESET[s], (cx / count / gw) * 2 - 1);
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
        const maxNotes = config.maxNotesPerSpecies;
        const sorted = orgHits.sort((a, b) => b.energy - a.energy).slice(0, maxNotes);
        for (const hit of sorted) {
          const pitch = this.pitchMap[Math.min(hit.row, this.pitchMap.length - 1)] ?? 'C3';
          const duration = this.melody.getDuration(presetIdx);
          this.bus.play(presetIdx, pitch, duration);
        }
      }
    }

    this._playheadCol = (col + 1) % gw;
  }

  dispose(): void {
    this.noiseSynth?.dispose();
    this.noiseFilter?.dispose();
    this.noisePanner?.dispose();
  }
}
