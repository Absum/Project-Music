import * as Tone from 'tone';

// Synth imports
import { SynthEngine } from './audio/engine.js';
import { setupKeyboard } from './ui/keyboard.js';
import { buildPresetSelector, buildSynthPanel, buildEffectsPanel, buildBusPanel } from './synth/controls.js';
import { Visualizer } from './ui/visualizer.js';

// Petri imports
import { createGrid, spawnOrganism, tick } from './petri/simulation/grid.js';
import { PetriRenderer } from './petri/renderer/canvas.js';
import { AudioEngine as PetriAudio } from './petri/audio/engine.js';
import { PetriControls } from './petri/controls.js';
import type { GridState, SimulationConfig } from './petri/types.js';

// --- State ---

let currentView: 'synth' | 'petri' = 'petri';
let initialized = false;

// Synth
const synthEngine = new SynthEngine();
let visualizer: Visualizer | null = null;

// Petri
const GRID_SIZE = 32;
const petriConfig: SimulationConfig = {
  bpm: 148, mutationRate: 0.3, resourceRegenRate: 1.5,
  reproductionThreshold: 40, maxOrganisms: 200, gravity: null,
};
let grid: GridState;
let petriRenderer: PetriRenderer;
let petriAudio: PetriAudio;
let petriControls: PetriControls;
let petriRunning = false;

function getTickInterval(): number {
  return Math.round(60000 / petriConfig.bpm / 2);
}

// --- View switching ---

function showView(view: 'synth' | 'petri'): void {
  currentView = view;
  document.getElementById('synth-view')!.classList.toggle('hidden', view !== 'synth');
  document.getElementById('petri-view')!.classList.toggle('hidden', view !== 'petri');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === view);
  });

  if (view === 'petri' && initialized && !petriRunning) {
    startPetri();
  }
}

// --- Synth setup ---

function rebuildSynthUI() {
  buildSynthPanel(document.getElementById('synth-col-left')!, document.getElementById('synth-col-right')!, synthEngine);
  buildEffectsPanel(document.getElementById('effects-panel')!, synthEngine);
  buildBusPanel(document.getElementById('bus-panel')!, synthEngine);
}

// --- Petri setup ---

let rebuildPetriBar: (() => void) | null = null;

function startPetri() {
  petriRunning = true;
  seedOrganisms();
  petriTick();
  petriRenderLoop();
  if (rebuildPetriBar) rebuildPetriBar();
}

function togglePetri() {
  petriRunning = !petriRunning;
  if (petriRunning) petriTick();
  if (rebuildPetriBar) rebuildPetriBar();
}

function petriTick() {
  if (!petriRunning) return;
  const events = tick(grid, petriConfig);
  petriAudio.processEvents(events, grid.width);
  petriAudio.updateOrganisms(grid);
  petriRenderer.processEvents(events);
  setTimeout(petriTick, getTickInterval());
}

function petriRenderLoop() {
  if (currentView === 'petri') {
    petriRenderer.resize();
    petriRenderer.render(grid, petriConfig.bpm);
  }
  requestAnimationFrame(petriRenderLoop);
}

function seedOrganisms() {
  const c = Math.floor(GRID_SIZE / 2);
  const o = 5;
  for (let i = 0; i < 3; i++) {
    spawnOrganism(grid, c - o + i, c - o, 0);
    spawnOrganism(grid, c + o - i, c - o, 1);
    spawnOrganism(grid, c - o + i, c + o, 2);
    spawnOrganism(grid, c + o - i, c + o, 3);
  }
}

// --- Init ---

async function init() {
  const startBtn = document.getElementById('start-btn')!;
  const mainUI = document.getElementById('main-ui')!;

  startBtn.addEventListener('click', async () => {
    await Tone.start();
    await synthEngine.start();
    startBtn.parentElement!.classList.add('hidden');
    mainUI.classList.remove('hidden');
    initialized = true;

    // Synth
    const scopeCanvas = document.getElementById('scope') as HTMLCanvasElement;
    visualizer = new Visualizer(scopeCanvas, synthEngine);
    visualizer.start();

    const presetsEl = document.getElementById('presets')!;
    buildPresetSelector(presetsEl, synthEngine, rebuildSynthUI);
    const resetBtn = document.createElement('button');
    resetBtn.className = 'preset-btn reset-btn';
    resetBtn.textContent = 'RESET';
    resetBtn.addEventListener('click', () => {
      synthEngine.resetToFactory();
      buildPresetSelector(presetsEl, synthEngine, rebuildSynthUI);
      presetsEl.appendChild(resetBtn);
      rebuildSynthUI();
    });
    presetsEl.appendChild(resetBtn);
    rebuildSynthUI();
    setupKeyboard(document.getElementById('keyboard')!, n => synthEngine.noteOn(n), n => synthEngine.noteOff(n));

    // Petri — wire synth presets as audio source
    grid = createGrid(GRID_SIZE, GRID_SIZE);
    petriAudio = new PetriAudio();
    petriAudio.setPresetSource(() => synthEngine.getAllPresets());
    await petriAudio.start();
    const petriCanvas = document.getElementById('petri-canvas') as HTMLCanvasElement;
    petriRenderer = new PetriRenderer(petriCanvas);
    petriControls = new PetriControls();
    const petriBar = document.getElementById('petri-bar')!;
    rebuildPetriBar = () => petriControls.buildBottomBar(petriBar, petriConfig, petriRunning, togglePetri);
    rebuildPetriBar();

    // Petri canvas interaction
    let painting = false;
    petriCanvas.addEventListener('mousedown', () => { painting = true; });
    window.addEventListener('mouseup', () => { painting = false; });
    petriCanvas.addEventListener('click', (e) => {
      const rect = petriCanvas.getBoundingClientRect();
      const cell = petriRenderer.getCellFromPixel(e.clientX - rect.left, e.clientY - rect.top, grid);
      if (cell) petriControls.applyTool(grid, cell.x, cell.y, petriConfig);
    });
    petriCanvas.addEventListener('mousemove', (e) => {
      if (!painting) return;
      const rect = petriCanvas.getBoundingClientRect();
      const cell = petriRenderer.getCellFromPixel(e.clientX - rect.left, e.clientY - rect.top, grid);
      if (cell) petriControls.applyTool(grid, cell.x, cell.y, petriConfig);
    });

    // Sidebar nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showView(btn.getAttribute('data-view') as 'synth' | 'petri');
      });
    });

    showView('petri');
    petriRenderLoop();
  });
}

init();
