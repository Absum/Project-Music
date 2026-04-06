import * as Tone from 'tone';
import type { Body, OrbitsState } from './simulation.js';
import { euclidean, getResonance } from './simulation.js';
import type { SynthPreset, FxSlot } from '../audio/presets.js';
import { getFxDef } from '../audio/fx-registry.js';

// Chord progression via Markov chain (minor key)
const CHORD_NOTES: Record<string, string[][]> = {
  'i':   [['C2','C3'], ['C3','Eb3','G3'], ['C4','Eb4','G4'], ['C5','Eb5','G5']],
  'iv':  [['F2','F3'], ['F3','Ab3','C4'], ['F4','Ab4','C5'], ['F5']],
  'v':   [['G2','G3'], ['G3','Bb3','D4'], ['G4','Bb4','D4'], ['G5','D5']],
  'VI':  [['Ab2','Ab3'], ['Ab3','C4','Eb4'], ['Ab4','C5','Eb5'], ['Ab5']],
  'III': [['Eb2','Eb3'], ['Eb3','G3','Bb3'], ['Eb4','G4','Bb4'], ['Eb5','G5']],
  'VII': [['Bb2','Bb3'], ['Bb3','D4','F4'], ['Bb4','D5','F5'], ['Bb5']],
  'ii':  [['D2','D3'], ['D3','F3','Ab3'], ['D4','F4','Ab4'], ['D5','F5']],
};

const TRANSITIONS: Record<string, { next: string; weight: number }[]> = {
  'i':   [{ next: 'iv', weight: 3 }, { next: 'v', weight: 2 }, { next: 'VI', weight: 2 }, { next: 'III', weight: 1 }],
  'iv':  [{ next: 'i', weight: 2 }, { next: 'v', weight: 3 }, { next: 'VII', weight: 1 }, { next: 'ii', weight: 1 }],
  'v':   [{ next: 'i', weight: 4 }, { next: 'VI', weight: 2 }, { next: 'iv', weight: 1 }],
  'VI':  [{ next: 'III', weight: 3 }, { next: 'iv', weight: 2 }, { next: 'v', weight: 1 }, { next: 'i', weight: 1 }],
  'III': [{ next: 'VI', weight: 2 }, { next: 'iv', weight: 2 }, { next: 'i', weight: 1 }, { next: 'VII', weight: 1 }],
  'VII': [{ next: 'III', weight: 2 }, { next: 'i', weight: 2 }, { next: 'v', weight: 1 }],
  'ii':  [{ next: 'v', weight: 3 }, { next: 'iv', weight: 1 }, { next: 'VII', weight: 1 }],
};

function nextChord(current: string): string {
  const options = TRANSITIONS[current] ?? TRANSITIONS['i'];
  const totalWeight = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * totalWeight;
  for (const opt of options) { r -= opt.weight; if (r <= 0) return opt.next; }
  return options[0].next;
}

interface VoiceChain {
  synth: Tone.FMSynth;
  filter: Tone.Filter;
  fxNodes: Tone.ToneAudioNode[];
  panner: Tone.Panner;
  sendGain: Tone.Gain;
}

export class OrbitsMusic {
  private voices: Map<number, VoiceChain> = new Map();
  private masterGain!: Tone.Gain;

  // Shared bus (reads from synth engine's bus config)
  private busNodes: Tone.ToneAudioNode[] = [];
  private busSendMerge!: Tone.Gain;
  private busReturn!: Tone.Gain;

  private kickSynth: Tone.FMSynth | null = null;
  private kickFilter: Tone.Filter | null = null;
  private kickFxNodes: Tone.ToneAudioNode[] = [];
  private kickPanner!: Tone.Panner;

  private currentChord = 'i';
  private chordTimer = 0;
  private chordInterval = 32;
  private initialized = false;

  private getPresets: (() => SynthPreset[]) | null = null;
  private getBusEffects: (() => FxSlot[]) | null = null;

  setPresetSource(fn: () => SynthPreset[]): void { this.getPresets = fn; }
  setBusSource(fn: () => FxSlot[]): void { this.getBusEffects = fn; }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    this.masterGain = new Tone.Gain(0.5).toDestination();
    this.busReturn = new Tone.Gain(0.6);
    this.busReturn.connect(this.masterGain);
    this.busSendMerge = new Tone.Gain(1);
    this.rebuildBus();

    this.kickPanner = new Tone.Panner(0);

    this.initialized = true;
  }

  tick(state: OrbitsState, bpm: number): void {
    if (!this.initialized) return;

    const now = Tone.now();

    // Chord progression
    this.chordTimer++;
    if (this.chordTimer >= this.chordInterval) {
      this.chordTimer = 0;
      this.currentChord = nextChord(this.currentChord);
    }

    // Process each body (skip center)
    for (const body of state.bodies) {
      if (body.role === 'center') continue;
      body.phase += 1 / body.loopBeats;
      if (body.phase >= 1) body.phase -= 1;

      const step = Math.floor(body.phase * body.euclideanN);
      const pattern = euclidean(body.euclideanK, body.euclideanN);
      const shouldPlay = pattern[step];
      const stepId = Math.floor(body.phase * body.euclideanN * 100);
      if (!shouldPlay || stepId === body.lastTrigger) continue;
      body.lastTrigger = stepId;

      if (body.role === 'kick') {
        this.ensureKick();
        if (this.kickSynth) {
          this.kickPanner.pan.rampTo(Math.max(-1, Math.min(1, body.x / 400)), 0.1);
          this.kickSynth.triggerAttackRelease('C2', '8n', now);
        }
        continue;
      }

      this.ensureVoice(body);
      const voice = this.voices.get(body.id);
      if (!voice) continue;

      // Pan from X position
      voice.panner.pan.rampTo(Math.max(-1, Math.min(1, body.x / 400)), 0.1);

      // Pitch from distance
      const dist = Math.sqrt(body.x ** 2 + body.y ** 2 + body.z ** 2);
      const octaveIndex = Math.min(3, Math.floor(dist / 120));
      const chordNotes = CHORD_NOTES[this.currentChord]?.[octaveIndex];
      if (!chordNotes || chordNotes.length === 0) continue;

      const note = chordNotes[Math.floor(Math.random() * chordNotes.length)];
      const baseDuration = body.role === 'pad' ? '2n' : body.role === 'bass' ? '4n' : '8n';
      voice.synth.triggerAttackRelease(note, baseDuration, now);
    }

    // Resonance → faster chord changes
    for (let i = 0; i < state.bodies.length; i++) {
      for (let j = i + 1; j < state.bodies.length; j++) {
        const res = getResonance(state.bodies[i], state.bodies[j]);
        if (res > 0.8 && this.chordTimer > this.chordInterval * 0.5) {
          this.chordTimer = this.chordInterval;
        }
      }
    }

    void bpm;
  }

  private ensureVoice(body: Body): void {
    if (this.voices.has(body.id)) return;
    const preset = this.getPresets?.()[body.presetIndex];
    if (!preset) return;

    const { synth, filter, fxNodes } = this.buildSynthFromPreset(preset);
    const panner = new Tone.Panner(0);
    const sendGain = new Tone.Gain(preset.busSend ?? 0);

    // Chain: synth → filter → [preset effects] → panner → masterGain
    //                                          └→ sendGain → bus
    let prev: Tone.ToneAudioNode = filter;
    for (const node of fxNodes) { prev.connect(node); prev = node; }
    prev.connect(panner);
    prev.connect(sendGain);
    panner.connect(this.masterGain);
    sendGain.connect(this.busSendMerge);

    this.voices.set(body.id, { synth, filter, fxNodes, panner, sendGain });
  }

  private ensureKick(): void {
    if (this.kickSynth) return;
    const preset = this.getPresets?.()[4]; // KICK preset
    if (!preset) return;

    const { synth, filter, fxNodes } = this.buildSynthFromPreset(preset);
    this.kickSynth = synth;
    this.kickFilter = filter;
    this.kickFxNodes = fxNodes;

    let prev: Tone.ToneAudioNode = filter;
    for (const node of fxNodes) { prev.connect(node); prev = node; }
    prev.connect(this.kickPanner);
    this.kickPanner.connect(this.masterGain);
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

  getCurrentChord(): string { return this.currentChord; }

  dispose(): void {
    for (const v of this.voices.values()) {
      v.synth.dispose(); v.filter.dispose(); v.panner.dispose(); v.sendGain.dispose();
      for (const n of v.fxNodes) n.dispose();
    }
    this.voices.clear();
    this.kickSynth?.dispose();
    this.kickFilter?.dispose();
    for (const n of this.kickFxNodes) n.dispose();
    this.kickPanner?.dispose();
    for (const n of this.busNodes) n.dispose();
    this.busSendMerge?.dispose();
    this.busReturn?.dispose();
    this.masterGain?.dispose();
  }
}
