import * as Tone from 'tone';
import type { GridState, SimulationEvent, CollisionConfig, MelodyConfig, NoteDuration } from '../types.js';
import type { SynthPreset } from '../../audio/presets.js';
import { buildPitchMap } from './scales.js';

const SPECIES_TO_PRESET = [1, 2, 0, 3];

const DEFAULT_MELODY_CONFIG: MelodyConfig = {
  rootNote: 'C', scaleType: 'minorPentatonic',
  octaveLow: 2, octaveHigh: 5,
  speciesDuration: ['4n', '8n', '8n', '16n'],
  kickDensity: 2, kickPitch: 'C2',
  maxNotesPerSpecies: 1, masterVolume: -7,
};

interface PresetSnapshot {
  oscType: string; harmonicity: number; modulationIndex: number; modWaveform: string;
  envelope: string; modEnvelope: string; filterCutoff: number; filterQ: number;
  filterType: string; volume: number; spread: number; count: number;
}

export class AudioEngine {
  // 4 species voices
  private synths: (Tone.FMSynth | null)[] = [null, null, null, null];
  private filters: (Tone.Filter | null)[] = [null, null, null, null];
  private gains: Tone.Gain[] = [];
  private panners: Tone.Panner[] = [];
  private shelves: Tone.Filter[] = [];

  // Kick
  private kickSynth: Tone.FMSynth | null = null;
  private kickFilter: Tone.Filter | null = null;
  private kickGain!: Tone.Gain;
  private lastKickSnapshot: PresetSnapshot | null = null;

  private noiseSynth!: Tone.NoiseSynth;
  private noisePanner!: Tone.Panner;
  private noiseFilter!: Tone.Filter;
  private lastNoiseType: string = 'pink';

  // Effects
  private dryBus!: Tone.Compressor;
  private wetBus!: Tone.Compressor;
  private delay!: Tone.PingPongDelay;
  private chorus!: Tone.Chorus;
  private reverb!: Tone.Reverb;
  private masterGain!: Tone.Gain;

  // Playhead state
  private _playheadCol = 0;
  private initialized = false;
  private lastCollisionTime = 0;
  private lastSnapshots: (PresetSnapshot | null)[] = [null, null, null, null];

  // Melody config
  private melodyConfig: MelodyConfig = { ...DEFAULT_MELODY_CONFIG, speciesDuration: [...DEFAULT_MELODY_CONFIG.speciesDuration] };
  private pitchMap: string[] = buildPitchMap('C', 'minorPentatonic', 2, 5, 32);

  // Preset source
  private getPresets: (() => SynthPreset[]) | null = null;

  get playheadCol(): number { return this._playheadCol; }

  setPresetSource(fn: () => SynthPreset[]): void {
    this.getPresets = fn;
  }

  setMelodyConfig(config: MelodyConfig): void {
    this.melodyConfig = config;
    this.pitchMap = buildPitchMap(config.rootNote, config.scaleType, config.octaveLow, config.octaveHigh, 32);
    if (this.masterGain) {
      this.masterGain.gain.rampTo(Tone.dbToGain(config.masterVolume), 0.1);
    }
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    this.dryBus = new Tone.Compressor(-14, 5);
    this.wetBus = new Tone.Compressor(-16, 4);
    this.delay = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.15, wet: 0.1 });
    this.chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.4, wet: 0.12 }).start();
    this.reverb = new Tone.Reverb({ decay: 1, wet: 0.5 });
    this.masterGain = new Tone.Gain(0.45);

    this.dryBus.connect(this.masterGain);
    this.wetBus.connect(this.delay);
    this.delay.connect(this.chorus);
    this.chorus.connect(this.reverb);
    this.reverb.connect(this.masterGain);
    this.masterGain.toDestination();

    // Kick → dry
    this.kickGain = new Tone.Gain(1);
    this.kickGain.connect(this.dryBus);
    this.rebuildKick();

    // 4 species voices
    for (let i = 0; i < 4; i++) {
      const gain = new Tone.Gain(0.8);
      const shelf = new Tone.Filter(2000, 'highshelf');
      const panner = new Tone.Panner(0);
      gain.connect(shelf);
      shelf.connect(panner);
      panner.connect(i === 2 ? this.dryBus : this.wetBus);
      this.gains.push(gain);
      this.shelves.push(shelf);
      this.panners.push(panner);
    }

    // Collision
    this.noisePanner = new Tone.Panner(0);
    this.noiseFilter = new Tone.Filter(4000, 'lowpass');
    this.noiseSynth = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
      volume: -22,
    });
    this.noiseSynth.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noisePanner);
    this.noisePanner.connect(this.wetBus);

    this.rebuildAllSynths();
    this.initialized = true;
  }

  processEvents(events: SimulationEvent[], gridWidth: number): void {
    if (!this.initialized) return;
    let collisions = 0;
    for (const event of events) {
      if (event.type === 'collision' && collisions < 1) {
        collisions++;
        this.onCollision(event, gridWidth);
      }
    }
  }

  // --- Main tick: scan the playhead column and play notes ---

  updateOrganisms(grid: GridState): void {
    if (!this.initialized) return;

    this.syncFromPresets();

    const col = this._playheadCol;
    const now = Tone.now();
    const gw = grid.width;

    // Scan current column — collect organisms by species
    const hits: { species: number; row: number; energy: number }[] = [];
    let hasAny = false;
    for (let y = 0; y < grid.height; y++) {
      const cell = grid.cells[y][col];
      if (cell.organism) {
        hits.push({ species: cell.organism.species, row: y, energy: cell.organism.energy });
        hasAny = true;
      }
    }

    // Kick — density from melody config
    let totalOrgs = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < gw; x++) {
        if (grid.cells[y][x].organism) totalOrgs++;
      }
    }
    if (totalOrgs > 0 && this.kickSynth && col % this.melodyConfig.kickDensity === 0) {
      this.kickSynth.triggerAttackRelease(this.melodyConfig.kickPitch, '8n', now);
    }

    // Spatial panning — based on species centroid across entire grid, not playhead
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
        this.panners[s].pan.rampTo((cx / count / gw) * 2 - 1, 0.15);
      }
    }

    // Play notes from this column
    if (hasAny) {
      const bySpecies: Map<number, { row: number; energy: number }[]> = new Map();
      for (const hit of hits) {
        const list = bySpecies.get(hit.species) || [];
        list.push(hit);
        bySpecies.set(hit.species, list);
      }

      let offset = 0;
      for (const [species, orgHits] of bySpecies) {
        const synth = this.synths[species];
        if (!synth) continue;

        const sorted = orgHits.sort((a, b) => b.energy - a.energy).slice(0, this.melodyConfig.maxNotesPerSpecies);
        for (const hit of sorted) {
          const pitch = this.rowToPitch(hit.row, grid.height);
          const duration = this.melodyConfig.speciesDuration[species] as NoteDuration;
          synth.triggerAttackRelease(pitch, duration, now + offset * 0.015);
          offset++;
        }
      }
    }

    // Advance playhead
    this._playheadCol = (col + 1) % gw;
  }

  private rowToPitch(row: number, gridHeight: number): string {
    const index = Math.floor((row / gridHeight) * this.pitchMap.length);
    return this.pitchMap[Math.min(index, this.pitchMap.length - 1)];
  }

  // --- Preset sync ---

  private getPresetForSpecies(species: number): SynthPreset | null {
    if (!this.getPresets) return null;
    return this.getPresets()[SPECIES_TO_PRESET[species]] ?? null;
  }

  private takeSnapshot(p: SynthPreset): PresetSnapshot {
    return {
      oscType: p.oscType, harmonicity: p.harmonicity, modulationIndex: p.modulationIndex,
      modWaveform: p.modWaveform, envelope: JSON.stringify(p.envelope),
      modEnvelope: JSON.stringify(p.modEnvelope), filterCutoff: p.filterCutoff,
      filterQ: p.filterQ, filterType: p.filterType, volume: p.volume,
      spread: p.spread, count: p.count,
    };
  }

  private snapshotChanged(a: PresetSnapshot | null, b: PresetSnapshot): boolean {
    if (!a) return true;
    return a.oscType !== b.oscType || a.harmonicity !== b.harmonicity ||
      a.modulationIndex !== b.modulationIndex || a.modWaveform !== b.modWaveform ||
      a.envelope !== b.envelope || a.modEnvelope !== b.modEnvelope ||
      a.filterCutoff !== b.filterCutoff || a.filterQ !== b.filterQ ||
      a.filterType !== b.filterType || a.volume !== b.volume ||
      a.spread !== b.spread || a.count !== b.count;
  }

  private rebuildAllSynths(): void {
    for (let i = 0; i < 4; i++) this.rebuildSynth(i);
    this.rebuildKick();
  }

  private rebuildSynth(species: number): void {
    this.synths[species]?.dispose();
    this.filters[species]?.dispose();

    const p = this.getPresetForSpecies(species);
    if (!p) {
      this.filters[species] = new Tone.Filter(2000, 'lowpass');
      this.synths[species] = new Tone.FMSynth({ volume: -16 });
      this.synths[species]!.connect(this.filters[species]!);
      this.filters[species]!.connect(this.gains[species]);
      return;
    }

    this.filters[species] = new Tone.Filter({
      frequency: p.filterCutoff, type: p.filterType as BiquadFilterType,
      Q: p.filterQ, rolloff: (p.filterRolloff ?? -12) as Tone.FilterRollOff,
    });

    const isFat = p.oscType.startsWith('fat');
    const oscOptions: Record<string, unknown> = { type: p.oscType };
    if (isFat) { oscOptions.spread = p.spread; oscOptions.count = p.count; }

    this.synths[species] = new Tone.FMSynth({
      harmonicity: p.harmonicity, modulationIndex: p.modulationIndex,
      oscillator: oscOptions as Tone.FMSynthOptions['oscillator'],
      modulation: { type: p.modWaveform } as Tone.FMSynthOptions['modulation'],
      envelope: p.envelope, modulationEnvelope: p.modEnvelope,
      volume: p.volume,
    });

    this.synths[species]!.connect(this.filters[species]!);
    this.filters[species]!.connect(this.gains[species]);
    this.lastSnapshots[species] = this.takeSnapshot(p);
  }

  private rebuildKick(): void {
    this.kickSynth?.dispose();
    this.kickFilter?.dispose();

    const p = this.getPresets ? this.getPresets()[4] : null;
    if (!p) {
      this.kickFilter = new Tone.Filter(5000, 'lowpass');
      this.kickSynth = new Tone.FMSynth({ envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 }, volume: -12 });
      this.kickSynth.connect(this.kickFilter);
      this.kickFilter.connect(this.kickGain);
      return;
    }

    this.kickFilter = new Tone.Filter({
      frequency: p.filterCutoff, type: p.filterType as BiquadFilterType,
      Q: p.filterQ, rolloff: (p.filterRolloff ?? -12) as Tone.FilterRollOff,
    });

    const isFat = p.oscType.startsWith('fat');
    const oscOptions: Record<string, unknown> = { type: p.oscType };
    if (isFat) { oscOptions.spread = p.spread; oscOptions.count = p.count; }

    this.kickSynth = new Tone.FMSynth({
      harmonicity: p.harmonicity, modulationIndex: p.modulationIndex,
      oscillator: oscOptions as Tone.FMSynthOptions['oscillator'],
      modulation: { type: p.modWaveform } as Tone.FMSynthOptions['modulation'],
      envelope: p.envelope, modulationEnvelope: p.modEnvelope, volume: p.volume,
    });
    this.kickSynth.connect(this.kickFilter);
    this.kickFilter.connect(this.kickGain);
    this.lastKickSnapshot = this.takeSnapshot(p);
  }

  private syncFromPresets(): void {
    for (let i = 0; i < 4; i++) {
      const p = this.getPresetForSpecies(i);
      if (!p) continue;
      const snap = this.takeSnapshot(p);
      if (!this.snapshotChanged(this.lastSnapshots[i], snap)) continue;

      const needsRebuild = !this.lastSnapshots[i] ||
        snap.oscType !== this.lastSnapshots[i]!.oscType ||
        snap.modWaveform !== this.lastSnapshots[i]!.modWaveform ||
        snap.filterType !== this.lastSnapshots[i]!.filterType ||
        snap.spread !== this.lastSnapshots[i]!.spread ||
        snap.count !== this.lastSnapshots[i]!.count;

      if (needsRebuild) {
        this.rebuildSynth(i);
      } else {
        const synth = this.synths[i];
        const filter = this.filters[i];
        if (synth) {
          synth.harmonicity.rampTo(p.harmonicity, 0.1);
          synth.modulationIndex.rampTo(p.modulationIndex, 0.1);
          synth.volume.rampTo(p.volume, 0.1);
          const env = synth.envelope as unknown as Record<string, unknown>;
          env.attack = p.envelope.attack; env.decay = p.envelope.decay;
          env.sustain = p.envelope.sustain; env.release = p.envelope.release;
          const modEnv = synth.modulationEnvelope as unknown as Record<string, unknown>;
          modEnv.attack = p.modEnvelope.attack; modEnv.decay = p.modEnvelope.decay;
          modEnv.sustain = p.modEnvelope.sustain; modEnv.release = p.modEnvelope.release;
        }
        if (filter) { filter.frequency.rampTo(p.filterCutoff, 0.1); filter.Q.rampTo(p.filterQ, 0.1); }
        this.lastSnapshots[i] = snap;
      }
    }

    // Kick sync
    if (this.getPresets) {
      const kickPreset = this.getPresets()[4];
      if (kickPreset) {
        const snap = this.takeSnapshot(kickPreset);
        if (this.snapshotChanged(this.lastKickSnapshot, snap)) {
          const needsRebuild = !this.lastKickSnapshot ||
            snap.oscType !== this.lastKickSnapshot.oscType ||
            snap.modWaveform !== this.lastKickSnapshot.modWaveform ||
            snap.filterType !== this.lastKickSnapshot.filterType ||
            snap.spread !== this.lastKickSnapshot.spread ||
            snap.count !== this.lastKickSnapshot.count;
          if (needsRebuild) { this.rebuildKick(); }
          else if (this.kickSynth && this.kickFilter) {
            this.kickSynth.harmonicity.rampTo(kickPreset.harmonicity, 0.1);
            this.kickSynth.modulationIndex.rampTo(kickPreset.modulationIndex, 0.1);
            this.kickSynth.volume.rampTo(kickPreset.volume, 0.1);
            const env = this.kickSynth.envelope as unknown as Record<string, unknown>;
            env.attack = kickPreset.envelope.attack; env.decay = kickPreset.envelope.decay;
            env.sustain = kickPreset.envelope.sustain; env.release = kickPreset.envelope.release;
            this.kickFilter.frequency.rampTo(kickPreset.filterCutoff, 0.1);
            this.kickFilter.Q.rampTo(kickPreset.filterQ, 0.1);
            this.lastKickSnapshot = snap;
          }
        }
      }
    }
  }

  syncCollisionConfig(c: CollisionConfig): void {
    if (!this.initialized) return;
    // Noise type change requires rebuild
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
      env.attack = c.attack;
      env.decay = c.decay;
      env.release = c.decay * 0.5;
    }
    this.noiseFilter.frequency.rampTo(c.filterCutoff, 0.1);
  }

  private onCollision(event: SimulationEvent, gridWidth: number): void {
    const pan = (event.x / gridWidth) * 2 - 1;
    this.noisePanner.pan.rampTo(pan, 0.01);
    const now = Tone.now();
    const startTime = Math.max(now, this.lastCollisionTime + 0.2);
    this.noiseSynth.triggerAttackRelease('32n', startTime);
    this.lastCollisionTime = startTime;
  }

  dispose(): void {
    for (const s of this.synths) s?.dispose();
    for (const f of this.filters) f?.dispose();
    for (const g of this.gains) g.dispose();
    for (const p of this.panners) p.dispose();
    for (const s of this.shelves) s.dispose();
    this.kickSynth?.dispose();
    this.kickFilter?.dispose();
    this.kickGain.dispose();
    this.noiseSynth.dispose();
    this.noiseFilter.dispose();
    this.noisePanner.dispose();
    this.dryBus.dispose();
    this.wetBus.dispose();
    this.chorus.dispose();
    this.delay.dispose();
    this.reverb.dispose();
    this.masterGain.dispose();
  }
}
