import type { SynthEngine } from '../audio/engine.js';
import type { FxSlot } from '../audio/presets.js';
import { PRESETS, OSC_TYPES, FILTER_TYPES, MOD_WAVEFORMS, ROLLOFF_VALUES } from '../audio/presets.js';
import { FX_REGISTRY, getFxDef } from '../audio/fx-registry.js';
import { createKnob } from '../ui/knob.js';
import { drawEnvelope, drawFilterResponse, drawOscillator, drawFM } from '../ui/visualizer.js';

// --- Helpers ---

function addSection(parent: HTMLElement, title: string): { section: HTMLElement; knobRow: HTMLElement } {
  const section = document.createElement('div');
  section.className = 'synth-section';
  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = title;
  section.appendChild(label);
  const knobRow = document.createElement('div');
  knobRow.className = 'knob-row';
  parent.appendChild(section);
  return { section, knobRow };
}

function addDropdown(parent: HTMLElement, label: string, options: string[], value: string, onChange: (v: string) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'dropdown-wrap';
  const lbl = document.createElement('div');
  lbl.className = 'dropdown-label';
  lbl.textContent = label;
  const select = document.createElement('select');
  select.className = 'synth-select';
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = opt.toUpperCase();
    if (opt === value) el.selected = true;
    select.appendChild(el);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrap.appendChild(lbl);
  wrap.appendChild(select);
  parent.appendChild(wrap);
}

// --- Preset selector ---

export function buildPresetSelector(container: HTMLElement, engine: SynthEngine, onPresetChange: () => void): void {
  container.innerHTML = '';
  PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    if (i === engine.getPresetIndex()) btn.classList.add('active');
    btn.textContent = preset.name;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      engine.loadPreset(i);
      onPresetChange();
    });
    container.appendChild(btn);
  });
}

// --- Synth panel (two columns) ---

export function buildSynthPanel(leftCol: HTMLElement, rightCol: HTMLElement, engine: SynthEngine): void {
  leftCol.innerHTML = '';
  rightCol.innerHTML = '';
  const p = engine.preset;
  const rebuild = () => buildSynthPanel(leftCol, rightCol, engine);

  // ═══ LEFT COLUMN: MAIN + OSC + FM ═══

  // MAIN — spacer viz to match other sections' height
  const main = addSection(leftCol, 'MAIN');
  const mainViz = document.createElement('canvas');
  mainViz.className = 'viz-canvas';
  main.section.appendChild(mainViz);
  drawMainViz(mainViz, p.volume, p.busSend);
  createKnob(main.knobRow, { label: 'VOLUME', value: p.volume, min: -30, max: 0, step: 0.5, unit: 'dB', onChange: v => { engine.updateParam('volume', v); drawMainViz(mainViz, v, p.busSend); } });
  createKnob(main.knobRow, { label: 'BUS SEND', value: p.busSend, min: 0, max: 1, step: 0.01, onChange: v => { engine.updateParam('busSend', v); drawMainViz(mainViz, p.volume, v); } });
  main.section.appendChild(main.knobRow);

  // OSCILLATOR — viz above knobs
  const osc = addSection(leftCol, 'OSCILLATOR');
  const oscCanvas = document.createElement('canvas');
  oscCanvas.className = 'viz-canvas';
  const redrawOsc = () => drawOscillator(oscCanvas, p.oscType, p.spread, p.count);
  osc.section.appendChild(oscCanvas);
  redrawOsc();
  addDropdown(osc.knobRow, 'WAVEFORM', OSC_TYPES, p.oscType, v => { engine.updateParam('oscType', v); rebuild(); });
  createKnob(osc.knobRow, { label: 'DETUNE', value: p.detune, min: -100, max: 100, step: 1, unit: 'ct', onChange: v => engine.updateParam('detune', v) });
  createKnob(osc.knobRow, { label: 'GLIDE', value: p.portamento, min: 0, max: 0.5, step: 0.005, unit: 's', onChange: v => engine.updateParam('portamento', v) });
  if (p.oscType.startsWith('fat')) {
    createKnob(osc.knobRow, { label: 'SPREAD', value: p.spread, min: 0, max: 100, step: 1, unit: 'ct', onChange: v => { engine.updateParam('spread', v); redrawOsc(); } });
    createKnob(osc.knobRow, { label: 'VOICES', value: p.count, min: 1, max: 8, step: 1, onChange: v => { engine.updateParam('count', v); rebuild(); } });
  }
  osc.section.appendChild(osc.knobRow);

  // FM SYNTHESIS — viz above knobs
  {
    const fm = addSection(leftCol, 'FM SYNTHESIS');
    const fmCanvas = document.createElement('canvas');
    fmCanvas.className = 'viz-canvas';
    const redrawFM = () => drawFM(fmCanvas, p.harmonicity, p.modulationIndex, p.modWaveform);
    fm.section.appendChild(fmCanvas);
    redrawFM();
    createKnob(fm.knobRow, { label: 'HARM', value: p.harmonicity, min: 0.1, max: 12, step: 0.1, onChange: v => { engine.updateParam('harmonicity', v); redrawFM(); } });
    createKnob(fm.knobRow, { label: 'MOD IDX', value: p.modulationIndex, min: 0, max: 24, step: 0.1, onChange: v => { engine.updateParam('modulationIndex', v); redrawFM(); } });
    addDropdown(fm.knobRow, 'MOD WAVE', MOD_WAVEFORMS, p.modWaveform, v => { engine.updateParam('modWaveform', v); rebuild(); });
    fm.section.appendChild(fm.knobRow);
  }

  // ═══ RIGHT COLUMN: ENVELOPES + FILTER ═══

  // AMP ENVELOPE — viz above knobs
  const env = addSection(rightCol, 'AMP ENVELOPE');
  const envCanvas = document.createElement('canvas');
  envCanvas.className = 'viz-canvas';
  const redrawEnv = () => drawEnvelope(envCanvas, p.envelope);
  env.section.appendChild(envCanvas);
  redrawEnv();
  createKnob(env.knobRow, { label: 'ATTACK', value: p.envelope.attack, min: 0.001, max: 2, step: 0.001, unit: 's', onChange: v => { engine.updateParam('envelope.attack', v); redrawEnv(); } });
  createKnob(env.knobRow, { label: 'DECAY', value: p.envelope.decay, min: 0.01, max: 2, step: 0.01, unit: 's', onChange: v => { engine.updateParam('envelope.decay', v); redrawEnv(); } });
  createKnob(env.knobRow, { label: 'SUSTAIN', value: p.envelope.sustain, min: 0, max: 1, step: 0.01, onChange: v => { engine.updateParam('envelope.sustain', v); redrawEnv(); } });
  createKnob(env.knobRow, { label: 'RELEASE', value: p.envelope.release, min: 0.01, max: 5, step: 0.01, unit: 's', onChange: v => { engine.updateParam('envelope.release', v); redrawEnv(); } });
  env.section.appendChild(env.knobRow);

  // MOD ENVELOPE — viz above knobs
  {
    const mod = addSection(rightCol, 'MOD ENVELOPE');
    const modCanvas = document.createElement('canvas');
    modCanvas.className = 'viz-canvas';
    const redrawMod = () => drawEnvelope(modCanvas, p.modEnvelope);
    mod.section.appendChild(modCanvas);
    redrawMod();
    createKnob(mod.knobRow, { label: 'ATTACK', value: p.modEnvelope.attack, min: 0.001, max: 2, step: 0.001, unit: 's', onChange: v => { engine.updateParam('modEnvelope.attack', v); redrawMod(); } });
    createKnob(mod.knobRow, { label: 'DECAY', value: p.modEnvelope.decay, min: 0.01, max: 2, step: 0.01, unit: 's', onChange: v => { engine.updateParam('modEnvelope.decay', v); redrawMod(); } });
    createKnob(mod.knobRow, { label: 'SUSTAIN', value: p.modEnvelope.sustain, min: 0, max: 1, step: 0.01, onChange: v => { engine.updateParam('modEnvelope.sustain', v); redrawMod(); } });
    createKnob(mod.knobRow, { label: 'RELEASE', value: p.modEnvelope.release, min: 0.01, max: 5, step: 0.01, unit: 's', onChange: v => { engine.updateParam('modEnvelope.release', v); redrawMod(); } });
    mod.section.appendChild(mod.knobRow);
  }

  // FILTER — viz above knobs
  const flt = addSection(rightCol, 'FILTER');
  const filterCanvas = document.createElement('canvas');
  filterCanvas.className = 'viz-canvas';
  const redrawFilter = () => drawFilterResponse(filterCanvas, p.filterCutoff);
  flt.section.appendChild(filterCanvas);
  redrawFilter();
  addDropdown(flt.knobRow, 'TYPE', FILTER_TYPES, p.filterType, v => { engine.updateParam('filterType', v); rebuild(); });
  createKnob(flt.knobRow, { label: 'CUTOFF', value: p.filterCutoff, min: 20, max: 16000, step: 10, unit: 'Hz', onChange: v => { engine.updateParam('filterCutoff', v); redrawFilter(); } });
  createKnob(flt.knobRow, { label: 'RESO', value: p.filterQ, min: 0.1, max: 20, step: 0.1, onChange: v => engine.updateParam('filterQ', v) });
  addDropdown(flt.knobRow, 'SLOPE', ROLLOFF_VALUES.map(String), String(p.filterRolloff), v => { engine.updateParam('filterRolloff', Number(v)); rebuild(); });
  flt.section.appendChild(flt.knobRow);
}

// --- Effects panel (insert effects) ---

export function buildEffectsPanel(container: HTMLElement, engine: SynthEngine): void {
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'INSERT EFFECTS';
  container.appendChild(title);

  buildFxChain(container, engine.preset.effects, {
    onToggle: (i) => { engine.toggleEffect(i); buildEffectsPanel(container, engine); },
    onParamChange: (i, key, val) => engine.updateEffectParam(i, key, val),
    onReorder: (from, to) => { engine.reorderEffect(from, to); buildEffectsPanel(container, engine); },
    onRemove: (i) => { engine.removeEffect(i); buildEffectsPanel(container, engine); },
  }, (typeId) => { engine.addEffect(typeId); buildEffectsPanel(container, engine); });
}

// --- Bus panel (full-width bottom) ---

export function buildBusPanel(container: HTMLElement, engine: SynthEngine): void {
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'EFFECT BUS';
  container.appendChild(title);

  const chain = document.createElement('div');
  chain.className = 'bus-chain';

  buildFxChainHorizontal(chain, engine.busEffects, {
    onToggle: (i) => { engine.toggleBusEffect(i); buildBusPanel(container, engine); },
    onParamChange: (i, key, val) => engine.updateBusEffectParam(i, key, val),
    onReorder: (from, to) => { engine.reorderBusEffect(from, to); buildBusPanel(container, engine); },
    onRemove: (i) => { engine.removeBusEffect(i); buildBusPanel(container, engine); },
  }, (typeId) => { engine.addBusEffect(typeId); buildBusPanel(container, engine); });
  container.appendChild(chain);
}

// --- Shared FX chain builders ---

interface FxChainCallbacks {
  onToggle: (index: number) => void;
  onParamChange: (index: number, key: string, value: number) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

function buildFxCard(slot: FxSlot, idx: number, cb: FxChainCallbacks, knobSize = 40): HTMLElement {
  const def = getFxDef(slot.type);
  const card = document.createElement('div');
  card.className = `fx-card ${slot.enabled ? '' : 'disabled'}`;
  card.draggable = true;
  card.dataset.index = String(idx);

  const header = document.createElement('div');
  header.className = 'fx-header';
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '\u2261';
  const name = document.createElement('span');
  name.className = 'fx-name';
  name.textContent = (def?.name ?? slot.type).toUpperCase();
  const toggle = document.createElement('button');
  toggle.className = `fx-toggle ${slot.enabled ? 'on' : 'off'}`;
  toggle.textContent = slot.enabled ? 'ON' : 'OFF';
  toggle.addEventListener('click', () => cb.onToggle(idx));
  const removeBtn = document.createElement('button');
  removeBtn.className = 'fx-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.addEventListener('click', () => cb.onRemove(idx));

  header.appendChild(handle);
  header.appendChild(name);
  header.appendChild(toggle);
  header.appendChild(removeBtn);
  card.appendChild(header);

  if (slot.enabled && def) {
    const knobs = document.createElement('div');
    knobs.className = 'fx-knobs';
    for (const paramDef of def.params) {
      const val = slot.params[paramDef.key] ?? paramDef.default;
      createKnob(knobs, {
        label: paramDef.name, value: val, min: paramDef.min, max: paramDef.max,
        step: paramDef.step, unit: paramDef.unit, size: knobSize,
        onChange: v => cb.onParamChange(idx, paramDef.key, v),
      });
    }
    card.appendChild(knobs);
  }

  card.addEventListener('dragstart', (e) => { e.dataTransfer!.setData('text/plain', String(idx)); card.classList.add('dragging'); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('drag-over'); const from = parseInt(e.dataTransfer!.getData('text/plain')); if (from !== idx) cb.onReorder(from, idx); });

  return card;
}

function buildFxChain(container: HTMLElement, slots: FxSlot[], cb: FxChainCallbacks, onAdd: (typeId: string) => void): void {
  slots.forEach((slot, idx) => container.appendChild(buildFxCard(slot, idx, cb)));
  container.appendChild(createAddPlaceholder(onAdd));
}

function buildFxChainHorizontal(container: HTMLElement, slots: FxSlot[], cb: FxChainCallbacks, onAdd: (typeId: string) => void): void {
  slots.forEach((slot, idx) => container.appendChild(buildFxCard(slot, idx, cb, 36)));
  container.appendChild(createAddPlaceholder(onAdd, true));
}

function drawMainViz(canvas: HTMLCanvasElement, volume: number, busSend: number): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = 6;

  ctx.fillStyle = '#0c0e16';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(65,158,199,0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  // Volume meter bar
  const volNorm = (volume + 30) / 30; // -30..0 → 0..1
  const barY = pad + 6;
  const barH = 8;
  const barW = w - pad * 2;

  ctx.fillStyle = 'rgba(65,158,199,0.08)';
  ctx.fillRect(pad, barY, barW, barH);
  ctx.fillStyle = '#419EC7';
  ctx.fillRect(pad, barY, barW * volNorm, barH);

  ctx.font = '8px Rajdhani, monospace';
  ctx.fillStyle = 'rgba(65,158,199,0.4)';
  ctx.textAlign = 'left';
  ctx.fillText('VOL', pad + 2, barY + barH + 10);
  ctx.textAlign = 'right';
  ctx.fillText(`${volume.toFixed(1)} dB`, w - pad - 2, barY + barH + 10);

  // Bus send bar
  const sendY = barY + barH + 16;
  ctx.fillStyle = 'rgba(65,158,199,0.08)';
  ctx.fillRect(pad, sendY, barW, barH);
  ctx.fillStyle = 'rgba(199,160,65,0.7)';
  ctx.fillRect(pad, sendY, barW * busSend, barH);

  ctx.fillStyle = 'rgba(199,160,65,0.4)';
  ctx.textAlign = 'left';
  ctx.fillText('BUS', pad + 2, sendY + barH + 10);
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(busSend * 100)}%`, w - pad - 2, sendY + barH + 10);
}

function createAddPlaceholder(onAdd: (typeId: string) => void, horizontal = false): HTMLElement {
  const card = document.createElement('div');
  card.className = `fx-add-placeholder ${horizontal ? 'horizontal' : ''}`;
  card.textContent = '+';
  card.addEventListener('click', () => showFxModal(onAdd));
  return card;
}

function showFxModal(onSelect: (typeId: string) => void): void {
  // Remove existing modal if any
  document.getElementById('fx-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'fx-modal-overlay';
  overlay.className = 'fx-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'fx-modal';

  const title = document.createElement('div');
  title.className = 'fx-modal-title';
  title.textContent = 'ADD EFFECT';
  modal.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'fx-modal-grid';

  for (const def of FX_REGISTRY) {
    const item = document.createElement('button');
    item.className = 'fx-modal-item';
    item.textContent = def.name;
    item.addEventListener('click', () => {
      overlay.remove();
      onSelect(def.id);
    });
    grid.appendChild(item);
  }

  modal.appendChild(grid);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'fx-modal-close';
  closeBtn.textContent = 'CANCEL';
  closeBtn.addEventListener('click', () => overlay.remove());
  modal.appendChild(closeBtn);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
