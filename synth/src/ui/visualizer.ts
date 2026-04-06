import type { SynthEngine } from '../audio/engine.js';

export class Visualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private engine: SynthEngine;
  private animFrame = 0;

  constructor(canvas: HTMLCanvasElement, engine: SynthEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.engine = engine;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  start(): void {
    const loop = () => { this.draw(); this.animFrame = requestAnimationFrame(loop); };
    loop();
  }

  stop(): void { cancelAnimationFrame(this.animFrame); }

  private draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const ctx = this.ctx;

    ctx.fillStyle = '#0c0e16';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(65,158,199,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke(); }
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((w / 8) * i, 0); ctx.lineTo((w / 8) * i, h); ctx.stroke(); }

    // Center line
    ctx.strokeStyle = 'rgba(65,158,199,0.1)';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    // Waveform
    const waveform = this.engine.getWaveform();
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(65,158,199,0.12)';
    for (let i = 0; i < waveform.length; i++) {
      const x = (i / waveform.length) * w;
      const y = (1 - (waveform[i] + 1) / 2) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#419EC7';
    ctx.shadowColor = '#419EC7';
    ctx.shadowBlur = 6;
    for (let i = 0; i < waveform.length; i++) {
      const x = (i / waveform.length) * w;
      const y = (1 - (waveform[i] + 1) / 2) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

// --- ADSR Envelope visualization ---

export function drawEnvelope(canvas: HTMLCanvasElement, env: { attack: number; decay: number; sustain: number; release: number }): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = 4;

  ctx.fillStyle = '#0c0e16';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(65,158,199,0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  // Normalize times to fit width
  const totalTime = env.attack + env.decay + 0.3 + env.release; // 0.3 = sustain hold
  const scale = (w - pad * 2) / totalTime;
  const bottom = h - pad;
  const top = pad;

  const aEnd = pad + env.attack * scale;
  const dEnd = aEnd + env.decay * scale;
  const sEnd = dEnd + 0.3 * scale;
  const rEnd = sEnd + env.release * scale;
  const sustainY = top + (1 - env.sustain) * (bottom - top);

  // Fill
  ctx.beginPath();
  ctx.moveTo(pad, bottom);
  ctx.lineTo(aEnd, top);
  ctx.lineTo(dEnd, sustainY);
  ctx.lineTo(sEnd, sustainY);
  ctx.lineTo(rEnd, bottom);
  ctx.lineTo(pad, bottom);
  ctx.fillStyle = 'rgba(65,158,199,0.06)';
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(pad, bottom);
  ctx.lineTo(aEnd, top);
  ctx.lineTo(dEnd, sustainY);
  ctx.lineTo(sEnd, sustainY);
  ctx.lineTo(rEnd, bottom);
  ctx.strokeStyle = '#419EC7';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Phase labels
  ctx.fillStyle = 'rgba(65,158,199,0.3)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('A', (pad + aEnd) / 2, bottom - 2);
  ctx.fillText('D', (aEnd + dEnd) / 2, bottom - 2);
  ctx.fillText('S', (dEnd + sEnd) / 2, bottom - 2);
  ctx.fillText('R', (sEnd + rEnd) / 2, bottom - 2);
}

// --- Filter response visualization ---

export function drawFilterResponse(canvas: HTMLCanvasElement, cutoff: number, maxFreq = 8000): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = 4;

  ctx.fillStyle = '#0c0e16';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(65,158,199,0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  const bottom = h - pad;
  const top = pad;
  const range = w - pad * 2;

  // Draw lowpass response curve
  ctx.beginPath();
  for (let i = 0; i <= range; i++) {
    const freq = (i / range) * maxFreq;
    // Simple lowpass approximation: -12dB/octave rolloff past cutoff
    let gain = 1;
    if (freq > cutoff) {
      const octaves = Math.log2(freq / cutoff);
      gain = Math.pow(10, (-12 * octaves) / 20);
    }
    const x = pad + i;
    const y = top + (1 - gain) * (bottom - top);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }

  // Fill under curve
  ctx.lineTo(pad + range, bottom);
  ctx.lineTo(pad, bottom);
  ctx.fillStyle = 'rgba(65,158,199,0.06)';
  ctx.fill();

  // Redraw line on top
  ctx.beginPath();
  for (let i = 0; i <= range; i++) {
    const freq = (i / range) * maxFreq;
    let gain = 1;
    if (freq > cutoff) {
      const octaves = Math.log2(freq / cutoff);
      gain = Math.pow(10, (-12 * octaves) / 20);
    }
    const x = pad + i;
    const y = top + (1 - gain) * (bottom - top);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#419EC7';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Cutoff marker
  const cutoffX = pad + (cutoff / maxFreq) * range;
  ctx.beginPath();
  ctx.moveTo(cutoffX, top);
  ctx.lineTo(cutoffX, bottom);
  ctx.strokeStyle = 'rgba(65,158,199,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#419EC7';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(cutoff)}Hz`, cutoffX, bottom - 2);
}

// --- Oscillator waveform shape visualization ---

export function drawOscillator(canvas: HTMLCanvasElement, oscType: string, spread: number, count: number): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = 4;

  ctx.fillStyle = '#0c0e16';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(65,158,199,0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  // Center line
  ctx.beginPath();
  ctx.moveTo(pad, h / 2);
  ctx.lineTo(w - pad, h / 2);
  ctx.strokeStyle = 'rgba(65,158,199,0.08)';
  ctx.stroke();

  const baseType = oscType.replace('fat', '');
  const isFat = oscType.startsWith('fat');
  const cycles = 2.5;
  const range = w - pad * 2;
  const mid = h / 2;
  const amp = (h / 2 - pad) * 0.85;

  // Draw fat voices (detuned copies) as ghost lines
  if (isFat && count > 1 && spread > 0) {
    for (let v = 0; v < count; v++) {
      const detuneRatio = 1 + ((v / (count - 1)) - 0.5) * (spread / 1200) * 2;
      ctx.beginPath();
      for (let i = 0; i <= range; i++) {
        const t = (i / range) * cycles * Math.PI * 2 * detuneRatio;
        const y = mid - waveformSample(baseType, t) * amp * 0.6;
        if (i === 0) ctx.moveTo(pad + i, y); else ctx.lineTo(pad + i, y);
      }
      ctx.strokeStyle = `rgba(65,158,199,${0.08 + 0.04 * (v % 2)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Main waveform — fill
  ctx.beginPath();
  ctx.moveTo(pad, mid);
  for (let i = 0; i <= range; i++) {
    const t = (i / range) * cycles * Math.PI * 2;
    const y = mid - waveformSample(baseType, t) * amp;
    ctx.lineTo(pad + i, y);
  }
  ctx.lineTo(pad + range, mid);
  ctx.closePath();
  ctx.fillStyle = 'rgba(65,158,199,0.05)';
  ctx.fill();

  // Main waveform — line
  ctx.beginPath();
  for (let i = 0; i <= range; i++) {
    const t = (i / range) * cycles * Math.PI * 2;
    const y = mid - waveformSample(baseType, t) * amp;
    if (i === 0) ctx.moveTo(pad + i, y); else ctx.lineTo(pad + i, y);
  }
  ctx.strokeStyle = '#419EC7';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#419EC7';
  ctx.shadowBlur = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Label
  ctx.fillStyle = 'rgba(65,158,199,0.3)';
  ctx.font = '8px Rajdhani, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(oscType.toUpperCase(), w - pad - 2, h - pad - 1);
}

// --- FM Synthesis visualization ---

export function drawFM(canvas: HTMLCanvasElement, harmonicity: number, modulationIndex: number, modWaveform: string): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = 4;

  ctx.fillStyle = '#0c0e16';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(65,158,199,0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  // Center line
  ctx.beginPath();
  ctx.moveTo(pad, h / 2);
  ctx.lineTo(w - pad, h / 2);
  ctx.strokeStyle = 'rgba(65,158,199,0.08)';
  ctx.stroke();

  const range = w - pad * 2;
  const mid = h / 2;
  const amp = (h / 2 - pad) * 0.8;
  const cycles = 3;

  // Modulator wave (ghost)
  if (modulationIndex > 0.1) {
    ctx.beginPath();
    for (let i = 0; i <= range; i++) {
      const t = (i / range) * cycles * Math.PI * 2;
      const modT = t * harmonicity;
      const y = mid - waveformSample(modWaveform, modT) * amp * 0.3;
      if (i === 0) ctx.moveTo(pad + i, y); else ctx.lineTo(pad + i, y);
    }
    ctx.strokeStyle = 'rgba(199,130,65,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // FM result — carrier modulated by modulator
  ctx.beginPath();
  ctx.moveTo(pad, mid);
  for (let i = 0; i <= range; i++) {
    const t = (i / range) * cycles * Math.PI * 2;
    const modT = t * harmonicity;
    const modSignal = waveformSample(modWaveform, modT) * modulationIndex;
    const y = mid - Math.sin(t + modSignal) * amp;
    ctx.lineTo(pad + i, y);
  }
  ctx.lineTo(pad + range, mid);
  ctx.closePath();
  ctx.fillStyle = 'rgba(65,158,199,0.05)';
  ctx.fill();

  // FM result line
  ctx.beginPath();
  for (let i = 0; i <= range; i++) {
    const t = (i / range) * cycles * Math.PI * 2;
    const modT = t * harmonicity;
    const modSignal = waveformSample(modWaveform, modT) * modulationIndex;
    const y = mid - Math.sin(t + modSignal) * amp;
    if (i === 0) ctx.moveTo(pad + i, y); else ctx.lineTo(pad + i, y);
  }
  ctx.strokeStyle = '#419EC7';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#419EC7';
  ctx.shadowBlur = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Labels
  ctx.font = '8px Rajdhani, monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(65,158,199,0.3)';
  ctx.fillText(`H:${harmonicity.toFixed(1)} M:${modulationIndex.toFixed(1)}`, w - pad - 2, h - pad - 1);
  if (modulationIndex > 0.1) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(199,130,65,0.3)';
    ctx.fillText(`MOD: ${modWaveform.toUpperCase()}`, pad + 2, h - pad - 1);
  }
}

function waveformSample(type: string, t: number): number {
  const phase = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  switch (type) {
    case 'sine':
      return Math.sin(t);
    case 'square':
      return phase < Math.PI ? 1 : -1;
    case 'sawtooth':
      return 1 - (phase / Math.PI);
    case 'triangle':
      if (phase < Math.PI) return -1 + (2 * phase / Math.PI);
      return 3 - (2 * phase / Math.PI);
    default:
      return Math.sin(t);
  }
}
