export interface FxSlot {
  type: string;
  enabled: boolean;
  params: Record<string, number>;
}

export interface SynthPreset {
  name: string;
  type: 'fm';

  // Oscillator
  oscType: string;      // sine, square, sawtooth, triangle, fatsine, fatsquare, fatsawtooth, fattriangle
  detune: number;       // cents
  portamento: number;   // seconds (glide)
  spread: number;       // fat oscillator detuning spread (cents)
  count: number;        // fat oscillator voice count

  // FM
  harmonicity: number;
  modulationIndex: number;
  modWaveform: string;  // sine, square, sawtooth, triangle

  // Amplitude envelope
  envelope: { attack: number; decay: number; sustain: number; release: number };

  // Modulation envelope
  modEnvelope: { attack: number; decay: number; sustain: number; release: number };

  // Filter
  filterType: string;   // lowpass, highpass, bandpass, notch
  filterCutoff: number;
  filterQ: number;      // resonance
  filterRolloff: number; // -12, -24, -48

  // Main
  volume: number;
  busSend: number;

  // Effects
  effects: FxSlot[];
}

export const OSC_TYPES = [
  'sine', 'square', 'sawtooth', 'triangle',
  'fatsine', 'fatsquare', 'fatsawtooth', 'fattriangle',
];

export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'];
export const MOD_WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'];
export const ROLLOFF_VALUES = [-12, -24, -48];

export const PRESETS: SynthPreset[] = [
  {
    name: 'BASS', type: 'fm',
    oscType: 'sine', detune: 0, portamento: 0, spread: 0, count: 1,
    harmonicity: 1, modulationIndex: 2, modWaveform: 'square',
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.5 },
    modEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.3 },
    filterType: 'lowpass', filterCutoff: 500, filterQ: 1, filterRolloff: -12,
    volume: -12, busSend: 0.1,
    effects: [
      { type: 'reverb', enabled: true, params: { decay: 0.5, wet: 0.15 } },
    ],
  },
  {
    name: 'PAD', type: 'fm',
    oscType: 'fatsine', detune: 0, portamento: 0.05, spread: 30, count: 3,
    harmonicity: 0.5, modulationIndex: 0.5, modWaveform: 'sine',
    envelope: { attack: 0.5, decay: 0.8, sustain: 0.7, release: 1.5 },
    modEnvelope: { attack: 0.8, decay: 1.0, sustain: 0.5, release: 1.0 },
    filterType: 'lowpass', filterCutoff: 3000, filterQ: 1, filterRolloff: -12,
    volume: -16, busSend: 0.4,
    effects: [
      { type: 'delay', enabled: true, params: { delayTime: 0.3, feedback: 0.2, wet: 0.15 } },
      { type: 'chorus', enabled: true, params: { frequency: 0.8, depth: 0.4, wet: 0.2 } },
      { type: 'reverb', enabled: true, params: { decay: 3, wet: 0.5 } },
    ],
  },
  {
    name: 'LEAD', type: 'fm',
    oscType: 'sine', detune: 0, portamento: 0.02, spread: 0, count: 1,
    harmonicity: 3, modulationIndex: 4, modWaveform: 'sine',
    envelope: { attack: 0.03, decay: 0.2, sustain: 0.3, release: 0.6 },
    modEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.2, release: 0.4 },
    filterType: 'lowpass', filterCutoff: 2500, filterQ: 2, filterRolloff: -12,
    volume: -14, busSend: 0.25,
    effects: [
      { type: 'delay', enabled: true, params: { delayTime: 0.18, feedback: 0.25, wet: 0.12 } },
      { type: 'reverb', enabled: true, params: { decay: 1.5, wet: 0.3 } },
    ],
  },
  {
    name: 'ARP', type: 'fm',
    oscType: 'fattriangle', detune: 0, portamento: 0, spread: 20, count: 2,
    harmonicity: 2, modulationIndex: 1, modWaveform: 'triangle',
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.3 },
    modEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.1, release: 0.2 },
    filterType: 'lowpass', filterCutoff: 4000, filterQ: 1.5, filterRolloff: -12,
    volume: -15, busSend: 0.3,
    effects: [
      { type: 'delay', enabled: true, params: { delayTime: 0.12, feedback: 0.3, wet: 0.2 } },
      { type: 'chorus', enabled: true, params: { frequency: 2, depth: 0.5, wet: 0.15 } },
      { type: 'reverb', enabled: true, params: { decay: 1, wet: 0.25 } },
    ],
  },
  {
    name: 'KICK', type: 'fm',
    oscType: 'sine', detune: 0, portamento: 0, spread: 0, count: 1,
    harmonicity: 1, modulationIndex: 0, modWaveform: 'sine',
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    modEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
    filterType: 'lowpass', filterCutoff: 5000, filterQ: 1, filterRolloff: -12,
    volume: -12, busSend: 0,
    effects: [
      { type: 'reverb', enabled: true, params: { decay: 0.3, wet: 0.1 } },
    ],
  },
];
