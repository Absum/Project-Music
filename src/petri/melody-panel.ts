import type { MelodyConfig, SimulationConfig, NoteDuration, KickDensity } from './types.js';
import { SPECIES_PRESETS } from './simulation/species.js';
import { addSection, addDropdown } from '../synth/controls.js';
import { createKnob } from '../ui/knob.js';
import { ROOT_NOTES, SCALE_TYPES, SCALE_LABELS } from './audio/scales.js';

const DURATION_OPTIONS: NoteDuration[] = ['1n', '2n', '4n', '8n', '16n'];
const DURATION_LABELS: Record<NoteDuration, string> = { '1n': 'WHOLE', '2n': 'HALF', '4n': 'QTR', '8n': '8TH', '16n': '16TH' };
const KICK_PITCHES = ['C1', 'C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'C3'];
const KICK_DENSITY_OPTIONS: { label: string; value: KickDensity }[] = [
  { label: 'EVERY BEAT', value: 1 },
  { label: 'EVERY 2ND', value: 2 },
  { label: 'EVERY 4TH', value: 4 },
];
const SPECIES_COLORS = ['#419EC7', '#C74167', '#41C78A', '#C7A041'];

export function buildMelodyPanel(
  container: HTMLElement,
  melodyConfig: MelodyConfig,
  simConfig: SimulationConfig,
  onChange: () => void,
): void {
  container.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'MELODY';
  container.appendChild(title);

  const rebuild = () => buildMelodyPanel(container, melodyConfig, simConfig, onChange);

  // ═══ SCALE ═══
  const scale = addSection(container, 'SCALE');
  addDropdown(scale.knobRow, 'ROOT', ROOT_NOTES, melodyConfig.rootNote, v => {
    melodyConfig.rootNote = v as MelodyConfig['rootNote'];
    onChange();
  });
  // Scale type dropdown with custom labels
  const scaleWrap = document.createElement('div');
  scaleWrap.className = 'dropdown-wrap';
  const scaleLbl = document.createElement('div');
  scaleLbl.className = 'dropdown-label';
  scaleLbl.textContent = 'SCALE';
  const scaleSelect = document.createElement('select');
  scaleSelect.className = 'synth-select';
  for (const st of SCALE_TYPES) {
    const opt = document.createElement('option');
    opt.value = st;
    opt.textContent = SCALE_LABELS[st];
    if (st === melodyConfig.scaleType) opt.selected = true;
    scaleSelect.appendChild(opt);
  }
  scaleSelect.addEventListener('change', () => {
    melodyConfig.scaleType = scaleSelect.value as MelodyConfig['scaleType'];
    onChange();
  });
  scaleWrap.appendChild(scaleLbl);
  scaleWrap.appendChild(scaleSelect);
  scale.knobRow.appendChild(scaleWrap);
  scale.section.appendChild(scale.knobRow);

  // ═══ OCTAVE RANGE ═══
  const oct = addSection(container, 'OCTAVE RANGE');
  createKnob(oct.knobRow, { label: 'LOW', value: melodyConfig.octaveLow, min: 1, max: 4, step: 1, size: 44, onChange: v => {
    melodyConfig.octaveLow = v;
    if (melodyConfig.octaveLow > melodyConfig.octaveHigh) { melodyConfig.octaveHigh = v; rebuild(); return; }
    onChange();
  }});
  createKnob(oct.knobRow, { label: 'HIGH', value: melodyConfig.octaveHigh, min: 3, max: 6, step: 1, size: 44, onChange: v => {
    melodyConfig.octaveHigh = v;
    if (melodyConfig.octaveHigh < melodyConfig.octaveLow) { melodyConfig.octaveLow = v; rebuild(); return; }
    onChange();
  }});
  oct.section.appendChild(oct.knobRow);

  // ═══ NOTE DURATIONS ═══
  const dur = addSection(container, 'NOTE DURATION');
  for (let s = 0; s < 4; s++) {
    const wrap = document.createElement('div');
    wrap.className = 'dropdown-wrap';
    const lbl = document.createElement('div');
    lbl.className = 'dropdown-label';
    lbl.style.color = SPECIES_COLORS[s];
    lbl.textContent = SPECIES_PRESETS[s].name.slice(0, 3).toUpperCase();
    const select = document.createElement('select');
    select.className = 'synth-select';
    for (const d of DURATION_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = DURATION_LABELS[d];
      if (d === melodyConfig.speciesDuration[s]) opt.selected = true;
      select.appendChild(opt);
    }
    const speciesIdx = s;
    select.addEventListener('change', () => {
      melodyConfig.speciesDuration[speciesIdx] = select.value as NoteDuration;
      onChange();
    });
    wrap.appendChild(lbl);
    wrap.appendChild(select);
    dur.knobRow.appendChild(wrap);
  }
  dur.section.appendChild(dur.knobRow);

  // ═══ KICK ═══
  const kick = addSection(container, 'KICK');
  // Density dropdown
  const densWrap = document.createElement('div');
  densWrap.className = 'dropdown-wrap';
  const densLbl = document.createElement('div');
  densLbl.className = 'dropdown-label';
  densLbl.textContent = 'DENSITY';
  const densSelect = document.createElement('select');
  densSelect.className = 'synth-select';
  for (const d of KICK_DENSITY_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(d.value);
    opt.textContent = d.label;
    if (d.value === melodyConfig.kickDensity) opt.selected = true;
    densSelect.appendChild(opt);
  }
  densSelect.addEventListener('change', () => {
    melodyConfig.kickDensity = Number(densSelect.value) as KickDensity;
    onChange();
  });
  densWrap.appendChild(densLbl);
  densWrap.appendChild(densSelect);
  kick.knobRow.appendChild(densWrap);

  addDropdown(kick.knobRow, 'PITCH', KICK_PITCHES, melodyConfig.kickPitch, v => {
    melodyConfig.kickPitch = v;
    onChange();
  });
  kick.section.appendChild(kick.knobRow);

  // ═══ POLYPHONY ═══
  const poly = addSection(container, 'POLYPHONY');
  createKnob(poly.knobRow, { label: 'MAX NOTES', value: melodyConfig.maxNotesPerSpecies, min: 1, max: 4, step: 1, size: 44, onChange: v => {
    melodyConfig.maxNotesPerSpecies = v;
    onChange();
  }});
  poly.section.appendChild(poly.knobRow);

  // ═══ SIMULATION ═══
  const sim = addSection(container, 'SIMULATION');
  createKnob(sim.knobRow, { label: 'REPRO %', value: simConfig.reproductionProbability ?? 0.3, min: 0.05, max: 1, step: 0.01, size: 44, onChange: v => {
    simConfig.reproductionProbability = v;
  }});
  createKnob(sim.knobRow, { label: 'GRACE', value: simConfig.gracePeriodTicks ?? 5, min: 0, max: 20, step: 1, unit: 'tks', size: 44, onChange: v => {
    simConfig.gracePeriodTicks = v;
  }});
  sim.section.appendChild(sim.knobRow);

  // ═══ MASTER ═══
  const master = addSection(container, 'MASTER');
  createKnob(master.knobRow, { label: 'VOLUME', value: melodyConfig.masterVolume, min: -40, max: 0, step: 0.5, unit: 'dB', size: 44, onChange: v => {
    melodyConfig.masterVolume = v;
    onChange();
  }});
  master.section.appendChild(master.knobRow);
}
