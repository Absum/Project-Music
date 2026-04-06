import * as Tone from 'tone';

export class SpectrumAnalyser {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.bottom = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '20%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '10';
    container.style.position = 'relative';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    try {
      const audioCtx = (Tone.getContext() as unknown as { rawContext: AudioContext }).rawContext;
      this.analyser = audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      Tone.getDestination().connect(this.analyser);
    } catch { /* audio not ready */ }
  }

  draw(): void {
    if (!this.analyser || !this.dataArray) return;

    const container = this.canvas.parentElement;
    if (!container) return;
    const w = container.clientWidth;
    const h = Math.floor(container.clientHeight * 0.2);
    if (w === 0 || h === 0) return;

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    this.analyser.getByteFrequencyData(this.dataArray as Uint8Array<ArrayBuffer>);
    const ctx = this.ctx;
    const bufferLength = this.analyser.frequencyBinCount;

    ctx.clearRect(0, 0, w, h);

    // Logarithmic frequency mapping: 20Hz-20kHz
    const sampleRate = 44100;
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const numPoints = 200;

    // Fill
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < numPoints; i++) {
      const x = (i / numPoints) * w;
      const logFreq = logMin + (i / numPoints) * (logMax - logMin);
      const freq = Math.pow(10, logFreq);
      const binIndex = Math.min(Math.round(freq / (sampleRate / this.analyser.fftSize)), bufferLength - 1);
      const val = this.dataArray[binIndex] / 255;
      ctx.lineTo(x, h - val * h * 0.85);
    }
    ctx.lineTo(w, h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgba(65,158,199,0.0)');
    grad.addColorStop(0.3, 'rgba(65,158,199,0.1)');
    grad.addColorStop(0.6, 'rgba(80,180,200,0.15)');
    grad.addColorStop(1, 'rgba(100,210,220,0.2)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < numPoints; i++) {
      const x = (i / numPoints) * w;
      const logFreq = logMin + (i / numPoints) * (logMax - logMin);
      const freq = Math.pow(10, logFreq);
      const binIndex = Math.min(Math.round(freq / (sampleRate / this.analyser.fftSize)), bufferLength - 1);
      const val = this.dataArray[binIndex] / 255;
      if (i === 0) ctx.moveTo(x, h - val * h * 0.85);
      else ctx.lineTo(x, h - val * h * 0.85);
    }
    ctx.strokeStyle = 'rgba(65,158,199,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
