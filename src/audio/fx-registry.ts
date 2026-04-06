import * as Tone from 'tone';

export interface FxParamDef {
  key: string;
  name: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface FxTypeDef {
  id: string;
  name: string;
  params: FxParamDef[];
  create: (params: Record<string, number>) => Tone.ToneAudioNode;
  apply: (node: Tone.ToneAudioNode, params: Record<string, number>) => void;
  needsRebuild?: string[]; // param keys that require full rebuild when changed
}

export const FX_REGISTRY: FxTypeDef[] = [
  {
    id: 'delay', name: 'PingPong Delay',
    params: [
      { key: 'delayTime', name: 'TIME', min: 0.01, max: 1, step: 0.01, default: 0.25, unit: 's' },
      { key: 'feedback', name: 'FDBK', min: 0, max: 0.9, step: 0.01, default: 0.2 },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 0.15 },
    ],
    create: (p) => new Tone.PingPongDelay({ delayTime: p.delayTime, feedback: p.feedback, wet: p.wet }),
    apply: (n, p) => { const d = n as Tone.PingPongDelay; d.delayTime.rampTo(p.delayTime, 0.1); d.feedback.rampTo(p.feedback, 0.1); d.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'chorus', name: 'Chorus',
    params: [
      { key: 'frequency', name: 'RATE', min: 0.1, max: 10, step: 0.1, default: 0.8, unit: 'Hz' },
      { key: 'depth', name: 'DEPTH', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 0.15 },
    ],
    create: (p) => { const c = new Tone.Chorus({ frequency: p.frequency, delayTime: 3.5, depth: p.depth, wet: p.wet }); c.start(); return c; },
    apply: (n, p) => { const c = n as Tone.Chorus; c.frequency.rampTo(p.frequency, 0.1); c.depth = p.depth; c.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'reverb', name: 'Reverb',
    params: [
      { key: 'decay', name: 'DECAY', min: 0.1, max: 10, step: 0.1, default: 1.5, unit: 's' },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 0.35 },
    ],
    create: (p) => new Tone.Reverb({ decay: p.decay, wet: p.wet }),
    apply: (n, p) => { (n as Tone.Reverb).wet.rampTo(p.wet, 0.1); },
    needsRebuild: ['decay'],
  },
  {
    id: 'distortion', name: 'Distortion',
    params: [
      { key: 'distortion', name: 'DRIVE', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    create: (p) => new Tone.Distortion({ distortion: p.distortion, wet: p.wet }),
    apply: (n, p) => { const d = n as Tone.Distortion; d.distortion = p.distortion; d.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'phaser', name: 'Phaser',
    params: [
      { key: 'frequency', name: 'RATE', min: 0.1, max: 20, step: 0.1, default: 0.5, unit: 'Hz' },
      { key: 'octaves', name: 'OCT', min: 1, max: 6, step: 1, default: 3 },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    create: (p) => new Tone.Phaser({ frequency: p.frequency, octaves: p.octaves, wet: p.wet }),
    apply: (n, p) => { const ph = n as Tone.Phaser; ph.frequency.rampTo(p.frequency, 0.1); ph.octaves = p.octaves; ph.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'tremolo', name: 'Tremolo',
    params: [
      { key: 'frequency', name: 'RATE', min: 0.1, max: 20, step: 0.1, default: 4, unit: 'Hz' },
      { key: 'depth', name: 'DEPTH', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    create: (p) => { const t = new Tone.Tremolo({ frequency: p.frequency, depth: p.depth, wet: p.wet }); t.start(); return t; },
    apply: (n, p) => { const t = n as Tone.Tremolo; t.frequency.rampTo(p.frequency, 0.1); t.depth.rampTo(p.depth, 0.1); t.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'bitcrusher', name: 'BitCrusher',
    params: [
      { key: 'bits', name: 'BITS', min: 1, max: 16, step: 1, default: 8 },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    create: (p) => { const b = new Tone.BitCrusher(p.bits); b.wet.value = p.wet; return b; },
    apply: (n, p) => { const b = n as Tone.BitCrusher; b.bits.rampTo(p.bits, 0.1); b.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'eq3', name: 'EQ3',
    params: [
      { key: 'low', name: 'LOW', min: -24, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'mid', name: 'MID', min: -24, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'high', name: 'HIGH', min: -24, max: 12, step: 0.5, default: 0, unit: 'dB' },
    ],
    create: (p) => new Tone.EQ3(p.low, p.mid, p.high),
    apply: (n, p) => { const eq = n as Tone.EQ3; eq.low.rampTo(p.low, 0.1); eq.mid.rampTo(p.mid, 0.1); eq.high.rampTo(p.high, 0.1); },
  },
  {
    id: 'compressor', name: 'Compressor',
    params: [
      { key: 'threshold', name: 'THRESH', min: -60, max: 0, step: 1, default: -20, unit: 'dB' },
      { key: 'ratio', name: 'RATIO', min: 1, max: 20, step: 0.5, default: 4 },
      { key: 'attack', name: 'ATK', min: 0, max: 1, step: 0.001, default: 0.003, unit: 's' },
      { key: 'release', name: 'REL', min: 0.01, max: 1, step: 0.01, default: 0.25, unit: 's' },
    ],
    create: (p) => new Tone.Compressor({ threshold: p.threshold, ratio: p.ratio, attack: p.attack, release: p.release }),
    apply: (n, p) => { const c = n as Tone.Compressor; c.threshold.rampTo(p.threshold, 0.1); c.ratio.rampTo(p.ratio, 0.1); c.attack.rampTo(p.attack, 0.1); c.release.rampTo(p.release, 0.1); },
  },
  {
    id: 'autofilter', name: 'AutoFilter',
    params: [
      { key: 'frequency', name: 'RATE', min: 0.1, max: 20, step: 0.1, default: 1, unit: 'Hz' },
      { key: 'depth', name: 'DEPTH', min: 0, max: 1, step: 0.01, default: 0.6 },
      { key: 'baseFrequency', name: 'BASE', min: 100, max: 5000, step: 10, default: 200, unit: 'Hz' },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    create: (p) => { const f = new Tone.AutoFilter({ frequency: p.frequency, depth: p.depth, baseFrequency: p.baseFrequency, wet: p.wet }); f.start(); return f; },
    apply: (n, p) => { const f = n as Tone.AutoFilter; f.frequency.rampTo(p.frequency, 0.1); f.depth.rampTo(p.depth, 0.1); f.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'autowah', name: 'AutoWah',
    params: [
      { key: 'baseFrequency', name: 'BASE', min: 50, max: 2000, step: 10, default: 100, unit: 'Hz' },
      { key: 'octaves', name: 'OCT', min: 1, max: 8, step: 1, default: 4 },
      { key: 'sensitivity', name: 'SENS', min: -40, max: 0, step: 1, default: -20, unit: 'dB' },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    create: (p) => new Tone.AutoWah({ baseFrequency: p.baseFrequency, octaves: p.octaves, sensitivity: p.sensitivity, wet: p.wet }),
    apply: (n, p) => { const w = n as Tone.AutoWah; w.octaves = p.octaves; w.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'vibrato', name: 'Vibrato',
    params: [
      { key: 'frequency', name: 'RATE', min: 0.1, max: 20, step: 0.1, default: 5, unit: 'Hz' },
      { key: 'depth', name: 'DEPTH', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    create: (p) => new Tone.Vibrato({ frequency: p.frequency, depth: p.depth, wet: p.wet }),
    apply: (n, p) => { const v = n as Tone.Vibrato; v.frequency.rampTo(p.frequency, 0.1); v.depth.rampTo(p.depth, 0.1); v.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'freqshift', name: 'FreqShift',
    params: [
      { key: 'frequency', name: 'SHIFT', min: -500, max: 500, step: 1, default: 0, unit: 'Hz' },
      { key: 'wet', name: 'WET', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    create: (p) => new Tone.FrequencyShifter({ frequency: p.frequency, wet: p.wet }),
    apply: (n, p) => { const f = n as Tone.FrequencyShifter; f.frequency.rampTo(p.frequency, 0.1); f.wet.rampTo(p.wet, 0.1); },
  },
  {
    id: 'widener', name: 'Stereo Widener',
    params: [
      { key: 'width', name: 'WIDTH', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    create: (p) => new Tone.StereoWidener({ width: p.width }),
    apply: (n, p) => { (n as Tone.StereoWidener).width.rampTo(p.width, 0.1); },
  },
];

export function getFxDef(id: string): FxTypeDef | undefined {
  return FX_REGISTRY.find(f => f.id === id);
}

export function getDefaultParams(id: string): Record<string, number> {
  const def = getFxDef(id);
  if (!def) return {};
  const params: Record<string, number> = {};
  for (const p of def.params) params[p.key] = p.default;
  return params;
}
