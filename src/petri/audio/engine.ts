import * as Tone from 'tone';
import type { GridState, SimulationEvent, CollisionConfig, MelodyConfig, NoteDuration } from '../types.js';
import type { SynthPreset, FxSlot } from '../../audio/presets.js';
import { getFxDef } from '../../audio/fx-registry.js';
import { buildPitchMap } from './scales.js';

const SPECIES_TO_PRESET = [1, 2, 0, 3]; // Oscillaris→PAD, Sawtonis→LEAD, Quadrus→BASS, Triangula→ARP

const DEFAULT_MELODY_CONFIG: MelodyConfig = {
  rootNote: 'C', scaleType: 'minorPentatonic',
  octaveLow: 2, octaveHigh: 5,
  speciesDuration: ['4n', '8n', '8n', '16n'],
  kickDensity: 2, kickPitch: 'C2',
  maxNotesPerSpecies: 1, masterVolume: -7,
};

interface VoiceChain {
  synth: Tone.FMSynth;
  filter: Tone.Filter;
  fxNodes: Tone.ToneAudioNode[];
  panner: Tone.Panner;
  sendGain: Tone.Gain;
}

interface PresetSnapshot {
  oscType: string; harmonicity: number; modulationIndex: number; modWaveform: string;
  envelope: string; modEnvelope: string; filterCutoff: number; filterQ: number;
  filterType: string; volume: number; spread: number; count: number;
  effectsHash: string;
}

export class AudioEngine {
  // 4 species voices — each with full preset chain
  private voices: (VoiceChain | null)[] = [null, null, null, null];

  // Kick
  private kickVoice: VoiceChain | null = null;

  // Collision
  private noiseSynth!: Tone.NoiseSynth;
  private noisePanner!: Tone.Panner;
  private lastNoiseType = 'pink';
  private noiseFilter!: Tone.Filter;

  // Master
  private masterGain!: Tone.Gain;

  // Bus
  private busNodes: Tone.ToneAudioNode[] = [];
  private busSendMerge!: Tone.Gain;
  private busReturn!: Tone.Gain;

  // State
  private _playheadCol = 0;
  private initialized = false;
  private lastCollisionTime = 0;
  private lastSnapshots: (PresetSnapshot | null)[] = [null, null, null, null];
  private lastKickSnapshot: PresetSnapshot | null = null;

  // Melody config
  private melodyConfig: MelodyConfig = { ...DEFAULT_MELODY_CONFIG, speciesDuration: [...DEFAULT_MELODY_CONFIG.speciesDuration] };
  private pitchMap: string[] = buildPitchMap('C', 'minorPentatonic', 2, 5, 32);

  // Sources
  private getPresets: (() => SynthPreset[]) | null = null;
  private getBusEffects: (() => FxSlot[]) | null = null;

  get playheadCol(): number { return this._playheadCol; }

  setPresetSource(fn: () => SynthPreset[]): void { this.getPresets = fn; }
  setBusSource(fn: () => FxSlot[]): void { this.getBusEffects = fn; }

  setMelodyConfig(config: MelodyConfig): void {
    this.melodyConfig = config;
    this.pitchMap = buildPitchMap(config.rootNote, config.scaleType, config.octaveLow, config.octaveHigh, 32);
    if (this.masterGain) this.masterGain.gain.rampTo(Tone.dbToGain(config.masterVolume), 0.1);
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    this.masterGain = new Tone.Gain(0.5).toDestination();
    this.busReturn = new Tone.Gain(0.6);
    this.busReturn.connect(this.masterGain);
    this.busSendMerge = new Tone.Gain(1);
    this.rebuildBus();

    // Collision noise — connects directly to master (no preset effects)
    this.noisePanner = new Tone.Panner(0);
    this.noiseFilter = new Tone.Filter(4000, 'lowpass');
    this.noiseSynth = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
      volume: -26,
    });
    this.noiseSynth.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noisePanner);
    this.noisePanner.connect(this.masterGain);

    // Build initial voices
    this.rebuildAllVoices();
    this.initialized = true;
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

    this.syncFromPresets();

    const col = this._playheadCol;
    const now = Tone.now();
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
    if (totalOrgs > 0 && this.kickVoice && col % this.melodyConfig.kickDensity === 0) {
      this.kickVoice.synth.triggerAttackRelease(this.melodyConfig.kickPitch, '8n', now);
    }

    // Spatial panning from species centroid
    const gh = grid.height;
    for (let s = 0; s < 4; s++) {
      const voice = this.voices[s];
      if (!voice) continue;
      let cx = 0, count = 0;
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const org = grid.cells[y][x].organism;
          if (org && org.species === s) { cx += x; count++; }
        }
      }
      if (count > 0) voice.panner.pan.rampTo((cx / count / gw) * 2 - 1, 0.15);
    }

    // Play notes from this column
    if (hits.length > 0) {
      const bySpecies: Map<number, { row: number; energy: number }[]> = new Map();
      for (const hit of hits) {
        const list = bySpecies.get(hit.species) || [];
        list.push(hit);
        bySpecies.set(hit.species, list);
      }

      let offset = 0;
      for (const [species, orgHits] of bySpecies) {
        const voice = this.voices[species];
        if (!voice) continue;
        const sorted = orgHits.sort((a, b) => b.energy - a.energy).slice(0, this.melodyConfig.maxNotesPerSpecies);
        for (const hit of sorted) {
          const pitch = this.rowToPitch(hit.row, grid.height);
          const duration = this.melodyConfig.speciesDuration[species] as NoteDuration;
          voice.synth.triggerAttackRelease(pitch, duration, now + offset * 0.015);
          offset++;
        }
      }
    }

    this._playheadCol = (col + 1) % gw;
  }

  private rowToPitch(row: number, gridHeight: number): string {
    const index = Math.floor((row / gridHeight) * this.pitchMap.length);
    return this.pitchMap[Math.min(index, this.pitchMap.length - 1)];
  }

  // --- Build voices from presets ---

  private rebuildAllVoices(): void {
    for (let i = 0; i < 4; i++) this.rebuildVoice(i);
    this.rebuildKick();
  }

  private rebuildVoice(species: number): void {
    // Dispose old
    const old = this.voices[species];
    if (old) {
      old.synth.dispose(); old.filter.dispose(); old.panner.dispose(); old.sendGain.dispose();
      for (const n of old.fxNodes) n.dispose();
    }

    const preset = this.getPresetForSpecies(species);
    if (!preset) { this.voices[species] = null; return; }

    const { synth, filter, fxNodes } = this.buildSynthFromPreset(preset);
    const panner = new Tone.Panner(0);
    const sendGain = new Tone.Gain(preset.busSend ?? 0);

    let prev: Tone.ToneAudioNode = filter;
    for (const node of fxNodes) { prev.connect(node); prev = node; }
    prev.connect(panner);
    prev.connect(sendGain);
    panner.connect(this.masterGain);
    sendGain.connect(this.busSendMerge);

    this.voices[species] = { synth, filter, fxNodes, panner, sendGain };
    this.lastSnapshots[species] = this.takeSnapshot(preset);
  }

  private rebuildKick(): void {
    if (this.kickVoice) {
      this.kickVoice.synth.dispose(); this.kickVoice.filter.dispose();
      this.kickVoice.panner.dispose(); this.kickVoice.sendGain.dispose();
      for (const n of this.kickVoice.fxNodes) n.dispose();
    }

    const preset = this.getPresets ? this.getPresets()[4] : null;
    if (!preset) { this.kickVoice = null; return; }

    const { synth, filter, fxNodes } = this.buildSynthFromPreset(preset);
    const panner = new Tone.Panner(0);
    const sendGain = new Tone.Gain(preset.busSend ?? 0);

    let prev: Tone.ToneAudioNode = filter;
    for (const node of fxNodes) { prev.connect(node); prev = node; }
    prev.connect(panner);
    prev.connect(sendGain);
    panner.connect(this.masterGain);
    sendGain.connect(this.busSendMerge);

    this.kickVoice = { synth, filter, fxNodes, panner, sendGain };
    this.lastKickSnapshot = this.takeSnapshot(preset);
  }

  private buildSynthFromPreset(p: SynthPreset): { synth: Tone.FMSynth; filter: Tone.Filter; fxNodes: Tone.ToneAudioNode[] } {
    const filter = new Tone.Filter({
      frequency: p.filterCutoff,
      type: (p.filterType ?? 'lowpass') as BiquadFilterType,
      Q: p.filterQ ?? 1,
      rolloff: (p.filterRolloff ?? -12) as Tone.FilterRollOff,
    });

    const isFat = p.oscType?.startsWith('fat');
    const oscOptions: Record<string, unknown> = { type: p.oscType ?? 'sine' };
    if (isFat) { oscOptions.spread = p.spread; oscOptions.count = p.count; }

    const synth = new Tone.FMSynth({
      harmonicity: p.harmonicity ?? 1,
      modulationIndex: p.modulationIndex ?? 2,
      oscillator: oscOptions as Tone.FMSynthOptions['oscillator'],
      modulation: { type: (p.modWaveform ?? 'sine') as OscillatorType } as Tone.FMSynthOptions['modulation'],
      envelope: p.envelope,
      modulationEnvelope: p.modEnvelope ?? p.envelope,
      volume: p.volume ?? -16,
    });
    synth.connect(filter);

    // Build preset's effect chain
    const fxNodes: Tone.ToneAudioNode[] = [];
    if (p.effects) {
      for (const slot of p.effects) {
        if (!slot.enabled) continue;
        const def = getFxDef(slot.type);
        if (!def) continue;
        fxNodes.push(def.create(slot.params));
      }
    }

    return { synth, filter, fxNodes };
  }

  // --- Bus ---

  private rebuildBus(): void {
    for (const node of this.busNodes) { node.disconnect(); node.dispose(); }
    this.busNodes = [];
    this.busSendMerge.disconnect();

    let prev: Tone.ToneAudioNode = this.busSendMerge;
    const busEffects = this.getBusEffects?.() ?? [];
    for (const slot of busEffects) {
      if (!slot.enabled) continue;
      const def = getFxDef(slot.type);
      if (!def) continue;
      const node = def.create(slot.params);
      this.busNodes.push(node);
      prev.connect(node);
      prev = node;
    }
    prev.connect(this.busReturn);
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
      effectsHash: JSON.stringify(p.effects),
    };
  }

  private snapshotChanged(a: PresetSnapshot | null, b: PresetSnapshot): boolean {
    if (!a) return true;
    return a.oscType !== b.oscType || a.harmonicity !== b.harmonicity ||
      a.modulationIndex !== b.modulationIndex || a.modWaveform !== b.modWaveform ||
      a.envelope !== b.envelope || a.modEnvelope !== b.modEnvelope ||
      a.filterCutoff !== b.filterCutoff || a.filterQ !== b.filterQ ||
      a.filterType !== b.filterType || a.volume !== b.volume ||
      a.spread !== b.spread || a.count !== b.count ||
      a.effectsHash !== b.effectsHash;
  }

  private syncFromPresets(): void {
    for (let i = 0; i < 4; i++) {
      const p = this.getPresetForSpecies(i);
      if (!p) continue;
      const snap = this.takeSnapshot(p);
      if (this.snapshotChanged(this.lastSnapshots[i], snap)) {
        // Any change → full rebuild (effects chain may have changed)
        this.rebuildVoice(i);
      }
    }

    // Kick
    if (this.getPresets) {
      const kickPreset = this.getPresets()[4];
      if (kickPreset) {
        const snap = this.takeSnapshot(kickPreset);
        if (this.snapshotChanged(this.lastKickSnapshot, snap)) {
          this.rebuildKick();
        }
      }
    }
  }

  dispose(): void {
    for (const v of this.voices) {
      if (!v) continue;
      v.synth.dispose(); v.filter.dispose(); v.panner.dispose(); v.sendGain.dispose();
      for (const n of v.fxNodes) n.dispose();
    }
    if (this.kickVoice) {
      this.kickVoice.synth.dispose(); this.kickVoice.filter.dispose();
      this.kickVoice.panner.dispose(); this.kickVoice.sendGain.dispose();
      for (const n of this.kickVoice.fxNodes) n.dispose();
    }
    this.noiseSynth?.dispose();
    this.noiseFilter?.dispose();
    this.noisePanner?.dispose();
    for (const n of this.busNodes) n.dispose();
    this.busSendMerge?.dispose();
    this.busReturn?.dispose();
    this.masterGain?.dispose();
  }
}
