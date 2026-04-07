import type { AudioBus } from '../audio/bus.js';
import type { SynthEngine } from '../audio/engine.js';
import { createKnob } from '../ui/knob.js';

// Display order: KICK, BASS, PAD, LEAD, ARP → preset indices 4, 0, 1, 2, 3
const CHANNEL_ORDER = [4, 0, 1, 2, 3];
const CHANNEL_COLORS = ['#C74167', '#419EC7', '#41C78A', '#C7A041', '#9B59B6'];
const CHANNEL_NAMES = ['KICK', 'BASS', 'PAD', 'LEAD', 'ARP'];

export class Mixer {
  private container: HTMLElement;
  private bus: AudioBus;
  private engine: SynthEngine;
  private masterCanvas: HTMLCanvasElement | null = null;
  private masterCtx: CanvasRenderingContext2D | null = null;
  private animFrame = 0;

  constructor(container: HTMLElement, bus: AudioBus, engine: SynthEngine) {
    this.container = container;
    this.bus = bus;
    this.engine = engine;
    this.build();
    this.startAnimation();
  }

  private build(): void {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'mixer-wrapper';

    const strips = document.createElement('div');
    strips.className = 'mixer-strips';

    const presets = this.engine.getAllPresets();

    for (let ch = 0; ch < 5; ch++) {
      const presetIdx = CHANNEL_ORDER[ch];
      const cs = this.bus.channelStates[presetIdx];
      const preset = presets[presetIdx];
      const strip = document.createElement('div');
      strip.className = 'mixer-strip';

      // Header
      const header = document.createElement('div');
      header.className = 'strip-header';
      header.style.borderTopColor = CHANNEL_COLORS[ch];
      header.textContent = CHANNEL_NAMES[ch];
      strip.appendChild(header);

      // Volume
      const volRow = document.createElement('div');
      volRow.className = 'strip-knob-row';
      createKnob(volRow, {
        label: 'VOL', value: cs.savedVolume, min: -40, max: 0, step: 0.5, unit: 'dB', size: 38,
        onChange: v => this.bus.setChannelVolume(presetIdx, v),
      });
      strip.appendChild(volRow);

      // Filter
      const filterRow = document.createElement('div');
      filterRow.className = 'strip-knob-row';
      createKnob(filterRow, {
        label: 'FILTER', value: preset?.filterCutoff ?? 3000, min: 100, max: 16000, step: 10, unit: 'Hz', size: 38,
        onChange: v => this.bus.setChannelFilter(presetIdx, v),
      });
      strip.appendChild(filterRow);

      // Send
      const sendRow = document.createElement('div');
      sendRow.className = 'strip-knob-row';
      createKnob(sendRow, {
        label: 'SEND', value: preset?.busSend ?? 0, min: 0, max: 1, step: 0.01, size: 38,
        onChange: v => this.bus.setChannelSend(presetIdx, v),
      });
      strip.appendChild(sendRow);

      // Mute / Solo
      const btns = document.createElement('div');
      btns.className = 'strip-buttons';

      const muteBtn = document.createElement('button');
      muteBtn.className = `strip-btn mute ${cs.muted ? 'active' : ''}`;
      muteBtn.textContent = 'M';
      muteBtn.addEventListener('click', () => {
        this.bus.setMute(presetIdx, !cs.muted);
        this.build();
      });

      const soloBtn = document.createElement('button');
      soloBtn.className = `strip-btn solo ${cs.solo ? 'active' : ''}`;
      soloBtn.textContent = 'S';
      soloBtn.addEventListener('click', () => {
        this.bus.setSolo(presetIdx, !cs.solo);
        this.build();
      });

      btns.appendChild(muteBtn);
      btns.appendChild(soloBtn);
      strip.appendChild(btns);

      // Color bar
      const colorBar = document.createElement('div');
      colorBar.className = 'strip-color-bar';
      colorBar.style.backgroundColor = CHANNEL_COLORS[ch];
      strip.appendChild(colorBar);

      strips.appendChild(strip);
    }

    wrapper.appendChild(strips);

    // Master EQ
    const masterSection = document.createElement('div');
    masterSection.className = 'mixer-master-row';
    const masterLabel = document.createElement('div');
    masterLabel.className = 'section-label';
    masterLabel.textContent = 'MASTER EQ';
    masterLabel.style.width = '100%';
    masterSection.appendChild(masterLabel);

    const masterKnobs = document.createElement('div');
    masterKnobs.className = 'mixer-master-row';
    createKnob(masterKnobs, {
      label: 'HI-PASS', value: this.bus.hiPassFreq, min: 20, max: 500, step: 1, unit: 'Hz', size: 38,
      onChange: v => this.bus.setHiPass(v),
    });
    createKnob(masterKnobs, {
      label: 'LO-PASS', value: this.bus.loPassFreq, min: 1000, max: 20000, step: 100, unit: 'Hz', size: 38,
      onChange: v => this.bus.setLoPass(v),
    });
    masterSection.appendChild(masterKnobs);
    wrapper.appendChild(masterSection);

    // Master spectrum
    const specSection = document.createElement('div');
    specSection.className = 'mixer-spectrum';
    const specTitle = document.createElement('div');
    specTitle.className = 'section-label';
    specTitle.textContent = 'MASTER SPECTRUM';
    specSection.appendChild(specTitle);

    this.masterCanvas = document.createElement('canvas');
    this.masterCanvas.className = 'mixer-spectrum-canvas';
    specSection.appendChild(this.masterCanvas);
    this.masterCtx = this.masterCanvas.getContext('2d')!;

    wrapper.appendChild(specSection);
    this.container.appendChild(wrapper);
  }

  private startAnimation(): void {
    const draw = () => {
      this.drawSpectrum();
      this.animFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  private drawSpectrum(): void {
    const analyser = this.bus.masterAnalyser;
    if (!analyser || !this.masterCanvas || !this.masterCtx) return;

    const canvas = this.masterCanvas;
    const ctx = this.masterCtx;
    const container = canvas.parentElement;
    if (!container) return;

    const w = container.clientWidth;
    const h = 120;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(12,14,20,0.6)';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(65,158,199,0.06)';
    ctx.lineWidth = 1;
    for (const freq of [100, 1000, 10000]) {
      const x = (Math.log10(freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = 'rgba(65,158,199,0.2)';
      ctx.font = '8px Rajdhani, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x, h - 3);
    }

    // Spectrum
    const sampleRate = 44100;
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const numPoints = 300;

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < numPoints; i++) {
      const x = (i / numPoints) * w;
      const logFreq = logMin + (i / numPoints) * (logMax - logMin);
      const freq = Math.pow(10, logFreq);
      const binIndex = Math.min(Math.round(freq / (sampleRate / analyser.fftSize)), bufferLength - 1);
      ctx.lineTo(x, h - (dataArray[binIndex] / 255) * h * 0.9);
    }
    ctx.lineTo(w, h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgba(65,158,199,0.0)');
    grad.addColorStop(0.3, 'rgba(65,158,199,0.12)');
    grad.addColorStop(0.6, 'rgba(80,180,200,0.18)');
    grad.addColorStop(1, 'rgba(100,210,220,0.25)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < numPoints; i++) {
      const x = (i / numPoints) * w;
      const logFreq = logMin + (i / numPoints) * (logMax - logMin);
      const freq = Math.pow(10, logFreq);
      const binIndex = Math.min(Math.round(freq / (sampleRate / analyser.fftSize)), bufferLength - 1);
      const val = dataArray[binIndex] / 255;
      if (i === 0) ctx.moveTo(x, h - val * h * 0.9);
      else ctx.lineTo(x, h - val * h * 0.9);
    }
    ctx.strokeStyle = '#419EC7';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrame);
  }
}
