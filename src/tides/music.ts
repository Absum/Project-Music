import * as Tone from 'tone';
import type { TidesState } from './simulation.js';
import type { SynthPreset, FxSlot } from '../audio/presets.js';
import { getFxDef } from '../audio/fx-registry.js';

const CHORD_NOTES: Record<string, string[][]> = {
  'i':   [['C2','C3'], ['C3','Eb3','G3'], ['C4','Eb4','G4'], ['C5','Eb5','G5']],
  'iv':  [['F2','F3'], ['F3','Ab3','C4'], ['F4','Ab4','C5'], ['F5']],
  'v':   [['G2','G3'], ['G3','Bb3','D4'], ['G4','Bb4','D4'], ['G5','D5']],
  'VI':  [['Ab2','Ab3'], ['Ab3','C4','Eb4'], ['Ab4','C5','Eb5'], ['Ab5']],
  'III': [['Eb2','Eb3'], ['Eb3','G3','Bb3'], ['Eb4','G4','Bb4'], ['Eb5','G5']],
  'VII': [['Bb2','Bb3'], ['Bb3','D4','F4'], ['Bb4','D5','F5'], ['Bb5']],
};

const TRANSITIONS: Record<string, { next: string; weight: number }[]> = {
  'i':   [{ next: 'iv', weight: 3 }, { next: 'v', weight: 2 }, { next: 'VI', weight: 2 }, { next: 'III', weight: 1 }],
  'iv':  [{ next: 'i', weight: 2 }, { next: 'v', weight: 3 }, { next: 'VII', weight: 1 }],
  'v':   [{ next: 'i', weight: 4 }, { next: 'VI', weight: 2 }, { next: 'iv', weight: 1 }],
  'VI':  [{ next: 'III', weight: 3 }, { next: 'iv', weight: 2 }, { next: 'v', weight: 1 }],
  'III': [{ next: 'VI', weight: 2 }, { next: 'iv', weight: 2 }, { next: 'i', weight: 1 }],
  'VII': [{ next: 'III', weight: 2 }, { next: 'i', weight: 2 }, { next: 'v', weight: 1 }],
};

function nextChord(current: string): string {
  const options = TRANSITIONS[current] ?? TRANSITIONS['i'];
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const opt of options) { r -= opt.weight; if (r <= 0) return opt.next; }
  return options[0].next;
}

// 4 regions → 4 voices: bass, pad, lead, arp
const REGION_PRESETS = [0, 1, 2, 3]; // BASS, PAD, LEAD, ARP

interface VoiceChain {
  synth: Tone.FMSynth;
  filter: Tone.Filter;
  fxNodes: Tone.ToneAudioNode[];
  panner: Tone.Panner;
  sendGain: Tone.Gain;
}

interface RegionState {
  lastHeight: number;
  lastNoteIndex: number;
  crossedZero: boolean;  // wave crossed zero → trigger
}

export class TidesMusic {
  private voices: Map<number, VoiceChain> = new Map();
  private masterGain!: Tone.Gain;
  private busNodes: Tone.ToneAudioNode[] = [];
  private busSendMerge!: Tone.Gain;
  private busReturn!: Tone.Gain;

  private kickSynth: Tone.FMSynth | null = null;
  private kickFilter: Tone.Filter | null = null;
  private kickFxNodes: Tone.ToneAudioNode[] = [];

  private regionStates: RegionState[] = [];
  private currentChord = 'i';
  private chordTimer = 0;
  private chordInterval = 24;
  private initialized = false;
  private tickCount = 0;

  private getPresets: (() => SynthPreset[]) | null = null;
  private getBusEffects: (() => FxSlot[]) | null = null;

  setPresetSource(fn: () => SynthPreset[]): void { this.getPresets = fn; }
  setBusSource(fn: () => FxSlot[]): void { this.getBusEffects = fn; }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();
    const lowCut = new Tone.Filter({ frequency: 35, type: 'highpass', rolloff: -24 });
    this.masterGain = new Tone.Gain(1.0);
    this.masterGain.connect(lowCut);
    lowCut.toDestination();
    this.busReturn = new Tone.Gain(1.0);
    this.busReturn.connect(this.masterGain);
    this.busSendMerge = new Tone.Gain(1);
    this.rebuildBus();

    for (let i = 0; i < 4; i++) {
      this.regionStates.push({ lastHeight: 0, lastNoteIndex: 0, crossedZero: false });
    }

    this.initialized = true;
  }

  tick(state: TidesState): void {
    if (!this.initialized) return;
    this.tickCount++;
    const now = Tone.now();

    // Chord progression driven by total wave energy
    this.chordTimer++;
    this.chordInterval = Math.round(28 - state.totalEnergy * 40); // 8-28 beats
    this.chordInterval = Math.max(8, this.chordInterval);
    if (this.chordTimer >= this.chordInterval) {
      this.chordTimer = 0;
      this.currentChord = nextChord(this.currentChord);
    }

    // Kick on wave peaks — when total energy is high
    if (this.tickCount % 2 === 0 && state.totalEnergy > 0.15) {
      this.ensureKick();
      if (this.kickSynth) {
        this.kickSynth.triggerAttackRelease('C2', '8n', now);
      }
    }

    // Process each region
    for (let r = 0; r < 4; r++) {
      const rs = this.regionStates[r];
      const height = state.regionHeights[r];
      const delta = state.regionDeltas[r];

      // Detect zero-crossing (wave crest passing through)
      const wasPositive = rs.lastHeight > 0;
      const isPositive = height > 0;
      const zeroCrossing = wasPositive !== isPositive;

      // Detect peaks (wave crest)
      const wasPeak = rs.lastHeight > height && delta < 0 && height > 0.05;

      rs.lastHeight = height;

      // Trigger on zero crossings (rhythmic) and peaks (melodic)
      const shouldTrigger = zeroCrossing || wasPeak ||
        (Math.abs(height) > 0.2 && (this.tickCount + r * 3) % 4 === 0);

      if (!shouldTrigger) continue;

      this.ensureVoice(r);
      const voice = this.voices.get(r);
      if (!voice) continue;

      // Pan: regions 0,2 left, 1,3 right
      voice.panner.pan.rampTo(r % 2 === 0 ? -0.4 : 0.4, 0.1);

      // Octave from wave height (higher waves = higher pitch)
      const octaveIndex = Math.min(3, Math.max(0, Math.floor((height + 0.5) * 3)));
      const chordNotes = CHORD_NOTES[this.currentChord]?.[octaveIndex];
      if (!chordNotes || chordNotes.length === 0) continue;

      // Melodic memory — stepwise
      let noteIndex: number;
      if (Math.random() < 0.65) {
        noteIndex = Math.max(0, Math.min(chordNotes.length - 1, rs.lastNoteIndex + (delta > 0 ? 1 : -1)));
      } else {
        noteIndex = Math.floor(Math.random() * chordNotes.length);
      }
      rs.lastNoteIndex = noteIndex;

      const note = chordNotes[noteIndex];

      // Duration: bigger waves = longer notes
      const absDelta = Math.abs(delta);
      const duration = absDelta > 0.02 ? '4n' : absDelta > 0.01 ? '8n' : '16n';

      voice.synth.triggerAttackRelease(note, duration, now);
    }
  }

  private ensureVoice(regionIdx: number): void {
    if (this.voices.has(regionIdx)) return;
    const preset = this.getPresets?.()[REGION_PRESETS[regionIdx]];
    if (!preset) return;

    const { synth, filter, fxNodes } = this.buildSynthFromPreset(preset);
    const panner = new Tone.Panner(0);
    const sendGain = new Tone.Gain(preset.busSend ?? 0);

    let prev: Tone.ToneAudioNode = filter;
    for (const node of fxNodes) { prev.connect(node); prev = node; }
    prev.connect(panner);
    prev.connect(sendGain);
    panner.connect(this.masterGain);
    sendGain.connect(this.busSendMerge);

    this.voices.set(regionIdx, { synth, filter, fxNodes, panner, sendGain });
  }

  private ensureKick(): void {
    if (this.kickSynth) return;
    const preset = this.getPresets?.()[4];
    if (!preset) return;

    const { synth, filter, fxNodes } = this.buildSynthFromPreset(preset);
    this.kickSynth = synth;
    this.kickFilter = filter;
    this.kickFxNodes = fxNodes;

    let prev: Tone.ToneAudioNode = filter;
    for (const node of fxNodes) { prev.connect(node); prev = node; }
    prev.connect(this.masterGain);
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
    for (const n of this.busNodes) n.dispose();
    this.busSendMerge?.dispose();
    this.busReturn?.dispose();
    this.masterGain?.dispose();
  }
}
