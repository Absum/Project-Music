import * as Tone from 'tone';
import { PRESETS, type SynthPreset, type FxSlot } from './presets.js';
import { getFxDef, getDefaultParams } from './fx-registry.js';

const STORAGE_KEY = 'synth_presets';
const BUS_STORAGE_KEY = 'synth_bus';

export class SynthEngine {
  private synth: Tone.FMSynth | null = null;
  private filter: Tone.Filter | null = null;
  private masterGain: Tone.Gain | null = null;
  private analyser: Tone.Analyser | null = null;
  private initialized = false;
  private activeNotes = new Set<string>();

  private fxNodes: Tone.ToneAudioNode[] = [];
  private sendGain: Tone.Gain | null = null;
  private busNodes: Tone.ToneAudioNode[] = [];
  private busReturn: Tone.Gain | null = null;
  busEffects: FxSlot[] = [];

  preset: SynthPreset;
  private presetStates: SynthPreset[];

  constructor() {
    const saved = this.loadFromStorage();
    this.presetStates = saved ?? PRESETS.map(p => this.clonePreset(p));
    this.preset = this.presetStates[0];
    this.busEffects = this.loadBusFromStorage() ?? [
      { type: 'reverb', enabled: true, params: { decay: 2, wet: 0.4 } },
      { type: 'delay', enabled: true, params: { delayTime: 0.3, feedback: 0.2, wet: 0.2 } },
    ];
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();
    this.analyser = new Tone.Analyser('waveform', 256);
    this.masterGain = new Tone.Gain(0.8);
    this.busReturn = new Tone.Gain(0.6);
    this.sendGain = new Tone.Gain(this.preset.busSend ?? 0);
    this.masterGain.connect(this.analyser);
    this.busReturn.connect(this.analyser);
    this.analyser.toDestination();
    this.rebuildBus();
    this.buildSynth();
    this.initialized = true;
  }

  getWaveform(): Float32Array {
    if (!this.analyser) return new Float32Array(256);
    return this.analyser.getValue() as Float32Array;
  }

  loadPreset(index: number): void {
    if (!this.presetStates[index]) return;
    this.preset = this.presetStates[index];
    this.buildSynth();
  }

  getPresetIndex(): number { return this.presetStates.indexOf(this.preset); }

  // --- Parameter updates (rebuild synth for structural changes, ramp for continuous) ---

  updateParam(key: string, value: number | string): void {
    const p = this.preset;
    const numVal = typeof value === 'number' ? value : 0;

    // Structural changes that require rebuild
    if (key === 'oscType' || key === 'modWaveform' || key === 'filterType' || key === 'filterRolloff' || key === 'count') {
      (p as unknown as Record<string, unknown>)[key] = value;
      this.buildSynth();
      this.save();
      return;
    }

    switch (key) {
      case 'volume':
        p.volume = numVal;
        this.synth?.volume.rampTo(numVal, 0.05);
        break;
      case 'detune':
        p.detune = numVal;
        if (this.synth) this.synth.detune.rampTo(numVal, 0.05);
        break;
      case 'portamento':
        p.portamento = numVal;
        if (this.synth) (this.synth as unknown as { portamento: number }).portamento = numVal;
        break;
      case 'spread':
        p.spread = numVal;
        // Spread requires rebuild for fat oscillators
        this.buildSynth();
        break;
      case 'harmonicity':
        p.harmonicity = numVal;
        this.synth?.harmonicity.rampTo(numVal, 0.05);
        break;
      case 'modulationIndex':
        p.modulationIndex = numVal;
        this.synth?.modulationIndex.rampTo(numVal, 0.05);
        break;
      case 'filterCutoff':
        p.filterCutoff = numVal;
        this.filter?.frequency.rampTo(numVal, 0.05);
        break;
      case 'filterQ':
        p.filterQ = numVal;
        this.filter?.Q.rampTo(numVal, 0.05);
        break;
      case 'busSend':
        p.busSend = numVal;
        this.sendGain?.gain.rampTo(numVal, 0.05);
        break;
      default:
        // Envelope params: envelope.attack, modEnvelope.decay, etc.
        if (key.startsWith('envelope.')) {
          const ek = key.split('.')[1] as keyof SynthPreset['envelope'];
          p.envelope[ek] = numVal;
          if (this.synth && 'envelope' in this.synth) {
            (this.synth.envelope as unknown as Record<string, unknown>)[ek] = numVal;
          }
        } else if (key.startsWith('modEnvelope.')) {
          const ek = key.split('.')[1] as keyof SynthPreset['modEnvelope'];
          p.modEnvelope[ek] = numVal;
          if (this.synth) {
            (this.synth.modulationEnvelope as unknown as Record<string, unknown>)[ek] = numVal;
          }
        }
    }
    this.save();
  }

  // --- Per-preset effects ---

  addEffect(typeId: string): void {
    this.preset.effects.push({ type: typeId, enabled: true, params: getDefaultParams(typeId) });
    this.rebuildChain(); this.save();
  }
  removeEffect(index: number): void {
    this.preset.effects.splice(index, 1);
    this.rebuildChain(); this.save();
  }
  updateEffectParam(index: number, paramKey: string, value: number): void {
    const slot = this.preset.effects[index];
    if (!slot) return;
    slot.params[paramKey] = value;
    const def = getFxDef(slot.type);
    const node = this.fxNodes[index];
    if (def && node && slot.enabled) {
      if (def.needsRebuild?.includes(paramKey)) this.rebuildChain();
      else def.apply(node, slot.params);
    }
    this.save();
  }
  toggleEffect(index: number): void {
    const slot = this.preset.effects[index];
    if (slot) { slot.enabled = !slot.enabled; this.rebuildChain(); this.save(); }
  }
  reorderEffect(fromIdx: number, toIdx: number): void {
    const [moved] = this.preset.effects.splice(fromIdx, 1);
    this.preset.effects.splice(toIdx, 0, moved);
    this.rebuildChain(); this.save();
  }

  // --- Bus effects ---

  addBusEffect(typeId: string): void {
    this.busEffects.push({ type: typeId, enabled: true, params: getDefaultParams(typeId) });
    this.rebuildBus(); this.saveBus();
  }
  removeBusEffect(index: number): void {
    this.busEffects.splice(index, 1);
    this.rebuildBus(); this.saveBus();
  }
  updateBusEffectParam(index: number, paramKey: string, value: number): void {
    const slot = this.busEffects[index];
    if (!slot) return;
    slot.params[paramKey] = value;
    const def = getFxDef(slot.type);
    const node = this.busNodes[index];
    if (def && node && slot.enabled) {
      if (def.needsRebuild?.includes(paramKey)) this.rebuildBus();
      else def.apply(node, slot.params);
    }
    this.saveBus();
  }
  toggleBusEffect(index: number): void {
    const slot = this.busEffects[index];
    if (slot) { slot.enabled = !slot.enabled; this.rebuildBus(); this.saveBus(); }
  }
  reorderBusEffect(fromIdx: number, toIdx: number): void {
    const [moved] = this.busEffects.splice(fromIdx, 1);
    this.busEffects.splice(toIdx, 0, moved);
    this.rebuildBus(); this.saveBus();
  }

  // --- Keyboard ---

  noteOn(note: string): void {
    if (!this.synth || !this.initialized || this.activeNotes.has(note)) return;
    this.activeNotes.add(note);
    this.synth.triggerAttack(note);
  }
  noteOff(note: string): void {
    if (!this.synth || !this.activeNotes.has(note)) return;
    this.activeNotes.delete(note);
    this.synth.triggerRelease();
  }

  // --- Reset ---

  resetToFactory(): void {
    this.presetStates = PRESETS.map(p => this.clonePreset(p));
    const idx = Math.max(0, this.getPresetIndex());
    this.preset = this.presetStates[idx];
    this.busEffects = [
      { type: 'reverb', enabled: true, params: { decay: 2, wet: 0.4 } },
      { type: 'delay', enabled: true, params: { delayTime: 0.3, feedback: 0.2, wet: 0.2 } },
    ];
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BUS_STORAGE_KEY);
    this.rebuildBus();
    this.buildSynth();
  }

  // --- Build synth from preset ---

  private buildSynth(): void {
    this.synth?.dispose();
    this.filter?.dispose();
    this.synth = null;
    this.filter = null;
    if (!this.masterGain) return;

    const p = this.preset;

    // Filter
    this.filter = new Tone.Filter({
      frequency: p.filterCutoff,
      type: p.filterType as BiquadFilterType,
      Q: p.filterQ,
      rolloff: p.filterRolloff as Tone.FilterRollOff,
    });

    const isFat = p.oscType.startsWith('fat');
    const oscOptions: Record<string, unknown> = { type: p.oscType };
    if (isFat) {
      oscOptions.spread = p.spread;
      oscOptions.count = p.count;
    }

    this.synth = new Tone.FMSynth({
      harmonicity: p.harmonicity,
      modulationIndex: p.modulationIndex,
      oscillator: oscOptions as Tone.FMSynthOptions['oscillator'],
      modulation: { type: p.modWaveform } as Tone.FMSynthOptions['modulation'],
      envelope: p.envelope,
      modulationEnvelope: p.modEnvelope,
      volume: p.volume,
    });

    this.synth.detune.value = p.detune;
    (this.synth as unknown as { portamento: number }).portamento = p.portamento;
    this.synth.connect(this.filter);
    if (this.sendGain) this.sendGain.gain.rampTo(p.busSend ?? 0, 0.05);
    this.rebuildChain();
  }

  private rebuildChain(): void {
    if (!this.filter || !this.masterGain || !this.sendGain) return;
    for (const node of this.fxNodes) { node.disconnect(); node.dispose(); }
    this.fxNodes = [];
    this.filter.disconnect();

    let prev: Tone.ToneAudioNode = this.filter;
    for (const slot of this.preset.effects) {
      if (!slot.enabled) continue;
      const def = getFxDef(slot.type);
      if (!def) continue;
      const node = def.create(slot.params);
      this.fxNodes.push(node);
      prev.connect(node);
      prev = node;
    }
    prev.connect(this.masterGain);
    prev.connect(this.sendGain);
  }

  private rebuildBus(): void {
    if (!this.sendGain || !this.busReturn) return;
    for (const node of this.busNodes) { node.disconnect(); node.dispose(); }
    this.busNodes = [];
    this.sendGain.disconnect();

    let prev: Tone.ToneAudioNode = this.sendGain;
    for (const slot of this.busEffects) {
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

  // --- Persistence ---

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.presetStates)); } catch { /* */ }
  }
  private saveBus(): void {
    try { localStorage.setItem(BUS_STORAGE_KEY, JSON.stringify(this.busEffects)); } catch { /* */ }
  }
  private loadFromStorage(): SynthPreset[] | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SynthPreset[];
      if (!Array.isArray(parsed) || parsed.length !== PRESETS.length) return null;
      // Backfill missing fields from factory
      for (let i = 0; i < parsed.length; i++) {
        const f = PRESETS[i];
        const p = parsed[i];
        if (p.busSend === undefined) p.busSend = f.busSend ?? 0;
        if (p.oscType === undefined) p.oscType = f.oscType;
        if (p.detune === undefined) p.detune = f.detune;
        if (p.portamento === undefined) p.portamento = f.portamento;
        if (p.spread === undefined) p.spread = f.spread;
        if (p.count === undefined) p.count = f.count;
        if (p.harmonicity === undefined) p.harmonicity = f.harmonicity;
        if (p.modulationIndex === undefined) p.modulationIndex = f.modulationIndex;
        if (p.modWaveform === undefined) p.modWaveform = f.modWaveform;
        if (p.modEnvelope === undefined) p.modEnvelope = { ...f.modEnvelope };
        if (p.filterType === undefined) p.filterType = f.filterType;
        if (p.filterQ === undefined) p.filterQ = f.filterQ;
        if (p.filterRolloff === undefined) p.filterRolloff = f.filterRolloff;
        if (!Array.isArray(p.effects)) p.effects = f.effects.map(fx => ({ ...fx, params: { ...fx.params } }));
      }
      return parsed;
    } catch { return null; }
  }
  private loadBusFromStorage(): FxSlot[] | null {
    try {
      const raw = localStorage.getItem(BUS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  private clonePreset(p: SynthPreset): SynthPreset {
    return {
      ...p,
      envelope: { ...p.envelope },
      modEnvelope: { ...p.modEnvelope },
      effects: p.effects.map(fx => ({ ...fx, params: { ...fx.params } })),
    };
  }

  dispose(): void {
    this.synth?.dispose();
    this.filter?.dispose();
    for (const n of this.fxNodes) n.dispose();
    for (const n of this.busNodes) n.dispose();
    this.sendGain?.dispose();
    this.busReturn?.dispose();
    this.analyser?.dispose();
    this.masterGain?.dispose();
  }
}
