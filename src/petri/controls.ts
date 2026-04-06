import type { GridState, SimulationConfig } from './types.js';
import { SPECIES_PRESETS } from './simulation/species.js';
import { createKnob } from '../ui/knob.js';
import { floodResources, plague, mutateRegion, earthquake, spawnOrganism } from './simulation/grid.js';

export type Tool = 'place' | 'flood' | 'plague' | 'mutate' | 'earthquake';

const TOOLS: { tool: Tool; symbol: string; tip: string }[] = [
  { tool: 'place', symbol: '\u2022', tip: 'Place organisms' },
  { tool: 'flood', symbol: '\u2614', tip: 'Flood nutrients' },
  { tool: 'plague', symbol: '\u2620', tip: 'Plague' },
  { tool: 'mutate', symbol: '\u2622', tip: 'Mutate' },
  { tool: 'earthquake', symbol: '\u2301', tip: 'Earthquake' },
];

export class PetriControls {
  private selectedSpecies = 0;
  private activeTool: Tool = 'place';
  private _container: HTMLElement | null = null;
  private _config: SimulationConfig | null = null;
  private _running = true;
  private _onToggleRun: (() => void) | null = null;
  private _onToggleMelody: (() => void) | null = null;

  getSelectedSpecies(): number { return this.selectedSpecies; }
  getActiveTool(): Tool { return this.activeTool; }

  private rebuild(): void {
    if (this._container && this._config) {
      this.buildBottomBar(this._container, this._config, this._running, this._onToggleRun ?? undefined);
    }
  }

  applyTool(grid: GridState, cellX: number, cellY: number, _config: SimulationConfig): void {
    switch (this.activeTool) {
      case 'place': spawnOrganism(grid, cellX, cellY, this.selectedSpecies); break;
      case 'flood': floodResources(grid, cellX, cellY, 3); break;
      case 'plague': plague(grid, cellX, cellY, 3); break;
      case 'mutate': mutateRegion(grid, cellX, cellY, 3); break;
      case 'earthquake': earthquake(grid); break;
    }
  }

  setMelodyToggle(cb: () => void): void {
    this._onToggleMelody = cb;
  }

  buildBottomBar(container: HTMLElement, config: SimulationConfig, running = true, onToggleRun?: () => void): void {
    this._container = container;
    this._config = config;
    this._running = running;
    this._onToggleRun = onToggleRun ?? null;
    container.innerHTML = '';

    // Play/Stop button
    const playSection = document.createElement('div');
    playSection.className = 'petri-bar-section';
    const playBtn = document.createElement('button');
    playBtn.className = `tool-btn ${running ? 'active' : ''}`;
    playBtn.textContent = running ? '\u23F8' : '\u25B6';
    playBtn.title = running ? 'Pause' : 'Play';
    playBtn.addEventListener('click', () => { if (onToggleRun) onToggleRun(); });
    playSection.appendChild(playBtn);
    container.appendChild(playSection);

    // Species selector
    const speciesSection = document.createElement('div');
    speciesSection.className = 'petri-bar-section';
    const speciesLabel = document.createElement('div');
    speciesLabel.className = 'bar-section-label';
    speciesLabel.textContent = 'SPECIES';
    speciesSection.appendChild(speciesLabel);
    const speciesRow = document.createElement('div');
    speciesRow.className = 'species-row';
    SPECIES_PRESETS.forEach((preset, i) => {
      const btn = document.createElement('button');
      btn.className = `species-btn ${i === this.selectedSpecies && this.activeTool === 'place' ? 'active' : ''}`;
      btn.style.setProperty('--species-color', ['#419EC7', '#C74167', '#41C78A', '#C7A041'][i]);
      btn.textContent = preset.name.slice(0, 3).toUpperCase();
      btn.addEventListener('click', () => {
        this.selectedSpecies = i;
        this.activeTool = 'place';
        this.rebuild();
      });
      speciesRow.appendChild(btn);
    });
    speciesSection.appendChild(speciesRow);
    container.appendChild(speciesSection);

    // Tools
    const toolSection = document.createElement('div');
    toolSection.className = 'petri-bar-section';
    const toolLabel = document.createElement('div');
    toolLabel.className = 'bar-section-label';
    toolLabel.textContent = 'TOOLS';
    toolSection.appendChild(toolLabel);
    const toolRow = document.createElement('div');
    toolRow.className = 'tool-row';
    for (const t of TOOLS) {
      const btn = document.createElement('button');
      btn.className = `tool-btn ${this.activeTool === t.tool ? 'active' : ''}`;
      btn.textContent = t.symbol;
      btn.title = t.tip;
      btn.addEventListener('click', () => {
        this.activeTool = t.tool;
        this.rebuild();
      });
      toolRow.appendChild(btn);
    }
    toolSection.appendChild(toolRow);
    container.appendChild(toolSection);

    // Knobs
    const knobSection = document.createElement('div');
    knobSection.className = 'petri-bar-section';
    const knobLabel = document.createElement('div');
    knobLabel.className = 'bar-section-label';
    knobLabel.textContent = 'ENVIRONMENT';
    knobSection.appendChild(knobLabel);
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    createKnob(knobRow, { label: 'BPM', value: config.bpm, min: 40, max: 300, step: 1, size: 40, onChange: v => { config.bpm = v; } });
    createKnob(knobRow, { label: 'MUTATE', value: config.mutationRate, min: 0, max: 1, step: 0.01, size: 40, onChange: v => { config.mutationRate = v; } });
    createKnob(knobRow, { label: 'REGEN', value: config.resourceRegenRate, min: 0.1, max: 5, step: 0.1, size: 40, onChange: v => { config.resourceRegenRate = v; } });
    knobSection.appendChild(knobRow);
    container.appendChild(knobSection);

    // Auto-spawn toggle
    const spawnSection = document.createElement('div');
    spawnSection.className = 'petri-bar-section';
    const spawnBtn = document.createElement('button');
    spawnBtn.className = `tool-btn ${config.autoSpawn ? 'active' : ''}`;
    spawnBtn.textContent = '\u267B';
    spawnBtn.title = config.autoSpawn ? 'Auto-spawn: ON' : 'Auto-spawn: OFF';
    spawnBtn.addEventListener('click', () => { config.autoSpawn = !config.autoSpawn; this.rebuild(); });
    spawnSection.appendChild(spawnBtn);
    container.appendChild(spawnSection);

    // Collision sound
    const collSection = document.createElement('div');
    collSection.className = 'petri-bar-section';
    const collLabel = document.createElement('div');
    collLabel.className = 'bar-section-label';
    collLabel.textContent = 'COLLISION';
    collSection.appendChild(collLabel);

    const collRow = document.createElement('div');
    collRow.className = 'knob-row';

    // Noise type dropdown
    const typeWrap = document.createElement('div');
    typeWrap.className = 'dropdown-wrap';
    const typeLbl = document.createElement('div');
    typeLbl.className = 'dropdown-label';
    typeLbl.textContent = 'TYPE';
    const typeSelect = document.createElement('select');
    typeSelect.className = 'synth-select';
    for (const t of ['white', 'pink', 'brown']) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.toUpperCase();
      if (t === config.collision.noiseType) opt.selected = true;
      typeSelect.appendChild(opt);
    }
    typeSelect.addEventListener('change', () => { config.collision.noiseType = typeSelect.value as 'white' | 'pink' | 'brown'; });
    typeWrap.appendChild(typeLbl);
    typeWrap.appendChild(typeSelect);
    collRow.appendChild(typeWrap);

    createKnob(collRow, { label: 'VOL', value: config.collision.volume, min: -40, max: -6, step: 1, unit: 'dB', size: 40, onChange: v => { config.collision.volume = v; } });
    createKnob(collRow, { label: 'DECAY', value: config.collision.decay, min: 0.01, max: 0.5, step: 0.01, unit: 's', size: 40, onChange: v => { config.collision.decay = v; } });
    createKnob(collRow, { label: 'FILTER', value: config.collision.filterCutoff, min: 200, max: 10000, step: 50, unit: 'Hz', size: 40, onChange: v => { config.collision.filterCutoff = v; } });

    collSection.appendChild(collRow);
    container.appendChild(collSection);

    // Melody settings toggle (gear icon)
    if (this._onToggleMelody) {
      const gearSection = document.createElement('div');
      gearSection.className = 'petri-bar-section melody-toggle';
      const gearBtn = document.createElement('button');
      gearBtn.className = 'tool-btn';
      gearBtn.textContent = '\u2699';
      gearBtn.title = 'Melody Settings';
      const panel = document.getElementById('melody-panel');
      if (panel && !panel.classList.contains('hidden')) gearBtn.classList.add('active');
      const cb = this._onToggleMelody;
      gearBtn.addEventListener('click', () => cb());
      gearSection.appendChild(gearBtn);
      container.appendChild(gearSection);
    }
  }
}
