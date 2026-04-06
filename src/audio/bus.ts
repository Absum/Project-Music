import * as Tone from 'tone';
import type { SynthPreset, FxSlot } from './presets.js';
import { getFxDef } from './fx-registry.js';

export interface ChannelState {
  muted: boolean;
  solo: boolean;
  savedVolume: number;
}

interface Channel {
  synth: Tone.FMSynth;
  filter: Tone.Filter;
  fxNodes: Tone.ToneAudioNode[];
  panner: Tone.Panner;
  channelGain: Tone.Gain;
  sendGain: Tone.Gain;
  analyser: AnalyserNode | null;
  // Snapshot for detecting changes
  snapshot: string;
}

/**
 * Shared AudioBus — single centralized audio routing.
 * All visualization engines call bus.play() instead of managing voices.
 *
 * Signal flow per channel:
 *   FMSynth → Filter → [Preset Effects] → Panner → ChannelGain → MasterGain → HiPass → LoPass → Destination
 *                                        └→ SendGain → [Bus Effects] → BusReturn ──┘
 */
export class AudioBus {
  private channels: Channel[] = [];
  private masterGain!: Tone.Gain;
  private hiPass!: Tone.Filter;
  private loPass!: Tone.Filter;
  private busEffectNodes: Tone.ToneAudioNode[] = [];
  private busSendMerge!: Tone.Gain;
  private busReturn!: Tone.Gain;
  private initialized = false;

  // Public state
  channelStates: ChannelState[] = [];
  masterAnalyser: AnalyserNode | null = null;
  hiPassFreq = 30;
  loPassFreq = 20000;

  // Preset source
  private getPresets: (() => SynthPreset[]) | null = null;
  private getBusEffects: (() => FxSlot[]) | null = null;

  setPresetSource(fn: () => SynthPreset[]): void { this.getPresets = fn; }
  setBusEffectSource(fn: () => FxSlot[]): void { this.getBusEffects = fn; }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    // Master chain
    this.masterGain = new Tone.Gain(1.0);
    this.hiPass = new Tone.Filter({ frequency: this.hiPassFreq, type: 'highpass', rolloff: -48 });
    this.loPass = new Tone.Filter({ frequency: this.loPassFreq, type: 'lowpass', rolloff: -48 });

    this.masterGain.connect(this.hiPass);
    this.hiPass.connect(this.loPass);
    this.loPass.toDestination();

    // Master analyser
    try {
      const audioCtx = (Tone.getContext() as unknown as { rawContext: AudioContext }).rawContext;
      this.masterAnalyser = audioCtx.createAnalyser();
      this.masterAnalyser.fftSize = 2048;
      this.masterAnalyser.smoothingTimeConstant = 0.85;
      Tone.getDestination().connect(this.masterAnalyser);
    } catch { /* */ }

    // Bus send/return
    this.busSendMerge = new Tone.Gain(1);
    this.busReturn = new Tone.Gain(1.0);
    this.busReturn.connect(this.masterGain);
    this.rebuildBusEffects();

    // Create 5 channels
    const presets = this.getPresets?.() ?? [];
    for (let i = 0; i < 5; i++) {
      const preset = presets[i];
      const vol = preset?.volume ?? -16;
      this.channelStates.push({ muted: false, solo: false, savedVolume: vol });
      this.channels.push(this.buildChannel(preset));
    }

    this.initialized = true;
  }

  // --- Public API for visualization engines ---

  play(presetIndex: number, note: string, duration: string, pan = 0, time?: number): void {
    if (!this.initialized || presetIndex < 0 || presetIndex >= 5) return;
    const ch = this.channels[presetIndex];
    if (!ch) return;

    // Don't play if effectively muted
    if (ch.channelGain.gain.value < 0.001) return;

    ch.panner.pan.rampTo(Math.max(-1, Math.min(1, pan)), 0.05);
    ch.synth.triggerAttackRelease(note, duration, time ?? Tone.now());
  }

  // --- Mixer controls ---

  setChannelVolume(presetIndex: number, volume: number): void {
    if (!this.initialized || !this.channels[presetIndex]) return;
    const preset = this.getPresets?.()[presetIndex];
    if (preset) preset.volume = volume;
    this.channels[presetIndex].synth.volume.rampTo(volume, 0.05);
    this.channelStates[presetIndex].savedVolume = volume;
  }

  setChannelFilter(presetIndex: number, cutoff: number): void {
    if (!this.initialized || !this.channels[presetIndex]) return;
    const preset = this.getPresets?.()[presetIndex];
    if (preset) preset.filterCutoff = cutoff;
    this.channels[presetIndex].filter.frequency.rampTo(cutoff, 0.05);
  }

  setChannelSend(presetIndex: number, send: number): void {
    if (!this.initialized || !this.channels[presetIndex]) return;
    const preset = this.getPresets?.()[presetIndex];
    if (preset) preset.busSend = send;
    this.channels[presetIndex].sendGain.gain.rampTo(send, 0.05);
  }

  setChannelPan(presetIndex: number, pan: number): void {
    if (!this.initialized || !this.channels[presetIndex]) return;
    this.channels[presetIndex].panner.pan.rampTo(pan, 0.05);
  }

  setMute(presetIndex: number, muted: boolean): void {
    this.channelStates[presetIndex].muted = muted;
    this.applyMuteSolo();
  }

  setSolo(presetIndex: number, solo: boolean): void {
    this.channelStates[presetIndex].solo = solo;
    this.applyMuteSolo();
  }

  setHiPass(freq: number): void {
    this.hiPassFreq = freq;
    if (this.hiPass) this.hiPass.frequency.rampTo(freq, 0.1);
  }

  setLoPass(freq: number): void {
    this.loPassFreq = freq;
    if (this.loPass) this.loPass.frequency.rampTo(freq, 0.1);
  }

  // --- Preset sync (call periodically or on preset change) ---

  syncPresets(): void {
    if (!this.initialized || !this.getPresets) return;
    const presets = this.getPresets();

    for (let i = 0; i < 5; i++) {
      const preset = presets[i];
      if (!preset) continue;
      const ch = this.channels[i];
      const snap = this.takeSnapshot(preset);

      if (snap !== ch.snapshot) {
        // Structural change — rebuild channel
        const needsRebuild = this.needsRebuild(ch.snapshot, snap);
        if (needsRebuild) {
          this.rebuildChannel(i, preset);
        } else {
          // Ramp continuous params
          ch.synth.harmonicity.rampTo(preset.harmonicity, 0.1);
          ch.synth.modulationIndex.rampTo(preset.modulationIndex, 0.1);
          if (!this.channelStates[i].muted) {
            ch.synth.volume.rampTo(preset.volume, 0.1);
          }
          ch.filter.frequency.rampTo(preset.filterCutoff, 0.1);
          ch.filter.Q.rampTo(preset.filterQ ?? 1, 0.1);
          ch.sendGain.gain.rampTo(preset.busSend ?? 0, 0.1);

          const env = ch.synth.envelope as unknown as Record<string, unknown>;
          env.attack = preset.envelope.attack;
          env.decay = preset.envelope.decay;
          env.sustain = preset.envelope.sustain;
          env.release = preset.envelope.release;

          const modEnv = ch.synth.modulationEnvelope as unknown as Record<string, unknown>;
          modEnv.attack = preset.modEnvelope.attack;
          modEnv.decay = preset.modEnvelope.decay;
          modEnv.sustain = preset.modEnvelope.sustain;
          modEnv.release = preset.modEnvelope.release;
        }
        ch.snapshot = snap;
      }
    }
  }

  getChannelAnalyser(presetIndex: number): AnalyserNode | null {
    return this.channels[presetIndex]?.analyser ?? null;
  }

  // --- Internal ---

  private buildChannel(preset: SynthPreset | undefined): Channel {
    const p = preset;

    const filter = new Tone.Filter({
      frequency: p?.filterCutoff ?? 3000,
      type: (p?.filterType ?? 'lowpass') as BiquadFilterType,
      Q: p?.filterQ ?? 1,
      rolloff: (p?.filterRolloff ?? -12) as Tone.FilterRollOff,
    });

    const isFat = p?.oscType?.startsWith('fat');
    const oscOptions: Record<string, unknown> = { type: p?.oscType ?? 'sine' };
    if (isFat && p) { oscOptions.spread = p.spread; oscOptions.count = p.count; }

    const synth = new Tone.FMSynth({
      harmonicity: p?.harmonicity ?? 1,
      modulationIndex: p?.modulationIndex ?? 2,
      oscillator: oscOptions as Tone.FMSynthOptions['oscillator'],
      modulation: { type: (p?.modWaveform ?? 'sine') as OscillatorType } as Tone.FMSynthOptions['modulation'],
      envelope: p?.envelope ?? { attack: 0.05, decay: 0.2, sustain: 0.4, release: 0.5 },
      modulationEnvelope: p?.modEnvelope ?? { attack: 0.05, decay: 0.2, sustain: 0.3, release: 0.3 },
      volume: p?.volume ?? -16,
    });

    synth.connect(filter);

    // Build preset's effect chain
    const fxNodes: Tone.ToneAudioNode[] = [];
    if (p?.effects) {
      for (const slot of p.effects) {
        if (!slot.enabled) continue;
        const def = getFxDef(slot.type);
        if (!def) continue;
        fxNodes.push(def.create(slot.params));
      }
    }

    const panner = new Tone.Panner(0);
    const channelGain = new Tone.Gain(1);
    const sendGain = new Tone.Gain(p?.busSend ?? 0);

    // Chain: synth → filter → [effects] → panner + sendGain
    let prev: Tone.ToneAudioNode = filter;
    for (const node of fxNodes) { prev.connect(node); prev = node; }
    prev.connect(panner);
    prev.connect(sendGain);
    panner.connect(channelGain);
    channelGain.connect(this.masterGain);
    sendGain.connect(this.busSendMerge);

    // Per-channel analyser
    let analyser: AnalyserNode | null = null;
    try {
      const audioCtx = (Tone.getContext() as unknown as { rawContext: AudioContext }).rawContext;
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      channelGain.connect(analyser);
    } catch { /* */ }

    return {
      synth, filter, fxNodes, panner, channelGain, sendGain, analyser,
      snapshot: p ? this.takeSnapshot(p) : '',
    };
  }

  private rebuildChannel(index: number, preset: SynthPreset): void {
    const old = this.channels[index];
    // Dispose old
    old.synth.dispose();
    old.filter.dispose();
    old.panner.dispose();
    old.channelGain.dispose();
    old.sendGain.dispose();
    for (const n of old.fxNodes) n.dispose();

    this.channels[index] = this.buildChannel(preset);

    // Re-apply mute state
    const cs = this.channelStates[index];
    const anySolo = this.channelStates.some(s => s.solo);
    const shouldMute = cs.muted || (anySolo && !cs.solo);
    if (shouldMute) {
      this.channels[index].channelGain.gain.value = 0;
    }
  }

  private applyMuteSolo(): void {
    const anySolo = this.channelStates.some(s => s.solo);

    for (let i = 0; i < 5; i++) {
      const cs = this.channelStates[i];
      const ch = this.channels[i];
      if (!ch) continue;

      const shouldMute = cs.muted || (anySolo && !cs.solo);
      ch.channelGain.gain.rampTo(shouldMute ? 0 : 1, 0.05);
    }
  }

  private rebuildBusEffects(): void {
    for (const node of this.busEffectNodes) { node.disconnect(); node.dispose(); }
    this.busEffectNodes = [];
    this.busSendMerge.disconnect();

    let prev: Tone.ToneAudioNode = this.busSendMerge;
    const slots = this.getBusEffects?.() ?? [];
    for (const slot of slots) {
      if (!slot.enabled) continue;
      const def = getFxDef(slot.type);
      if (!def) continue;
      const node = def.create(slot.params);
      this.busEffectNodes.push(node);
      prev.connect(node);
      prev = node;
    }
    prev.connect(this.busReturn);
  }

  private takeSnapshot(p: SynthPreset): string {
    return `${p.oscType}|${p.harmonicity}|${p.modulationIndex}|${p.modWaveform}|${p.spread}|${p.count}|${p.filterType}|${p.filterRolloff}|${JSON.stringify(p.effects)}`;
  }

  private needsRebuild(oldSnap: string, newSnap: string): boolean {
    if (!oldSnap) return true;
    // Compare structural parts (oscType, modWaveform, filterType, effects)
    const oldParts = oldSnap.split('|');
    const newParts = newSnap.split('|');
    // Indices: 0=oscType, 3=modWaveform, 4=spread, 5=count, 6=filterType, 7=rolloff, 8=effects
    return oldParts[0] !== newParts[0] || oldParts[3] !== newParts[3] ||
      oldParts[4] !== newParts[4] || oldParts[5] !== newParts[5] ||
      oldParts[6] !== newParts[6] || oldParts[7] !== newParts[7] ||
      oldParts[8] !== newParts[8];
  }

  dispose(): void {
    for (const ch of this.channels) {
      ch.synth.dispose(); ch.filter.dispose(); ch.panner.dispose();
      ch.channelGain.dispose(); ch.sendGain.dispose();
      for (const n of ch.fxNodes) n.dispose();
    }
    for (const n of this.busEffectNodes) n.dispose();
    this.busSendMerge?.dispose();
    this.busReturn?.dispose();
    this.masterGain?.dispose();
    this.hiPass?.dispose();
    this.loPass?.dispose();
  }
}
