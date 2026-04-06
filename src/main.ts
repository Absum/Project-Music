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
import { buildMelodyPanel } from './petri/melody-panel.js';
import type { GridState, SimulationConfig, MelodyConfig } from './petri/types.js';

// Orbits imports
import { createOrbitsState, tickOrbits, type OrbitsState } from './orbits/simulation.js';
import { OrbitsRenderer } from './orbits/renderer.js';
import { OrbitsMusic } from './orbits/music.js';

// --- State ---

let currentView: 'synth' | 'petri' | 'orbits' = 'orbits';
let initialized = false;

// Synth
const synthEngine = new SynthEngine();
let visualizer: Visualizer | null = null;

// Petri
const GRID_SIZE = 32;
const petriConfig: SimulationConfig = {
  bpm: 148, mutationRate: 0.3, resourceRegenRate: 2.0,
  reproductionThreshold: 40, maxOrganisms: 200, gravity: null,
  collision: { noiseType: 'pink', volume: -26, attack: 0.001, decay: 0.05, filterCutoff: 2450 },
  autoSpawn: true,
  reproductionProbability: 0.3,
  gracePeriodTicks: 5,
};

const melodyConfig: MelodyConfig = {
  rootNote: 'C', scaleType: 'minorPentatonic',
  octaveLow: 2, octaveHigh: 5,
  speciesDuration: ['4n', '8n', '8n', '16n'],
  kickDensity: 2, kickPitch: 'C2',
  maxNotesPerSpecies: 1, masterVolume: -7,
};
let grid: GridState;
let petriRenderer: PetriRenderer;
let petriAudio: PetriAudio;
let petriControls: PetriControls;
let petriRunning = false;

// Orbits
let orbitsState: OrbitsState;
let orbitsRenderer: OrbitsRenderer;
let orbitsMusic: OrbitsMusic;
let orbitsRunning = false;

function getTickInterval(): number {
  return Math.round(60000 / petriConfig.bpm / 2);
}

// --- View switching ---

function showView(view: 'synth' | 'petri' | 'orbits'): void {
  currentView = view;
  document.getElementById('synth-view')!.classList.toggle('hidden', view !== 'synth');
  document.getElementById('petri-view')!.classList.toggle('hidden', view !== 'petri');
  document.getElementById('orbits-view')!.classList.toggle('hidden', view !== 'orbits');
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === view);
  });

  // Rebuild synth UI when switching to synth (fixes zero-size visualizations)
  if (view === 'synth' && initialized) {
    requestAnimationFrame(() => rebuildSynthUI());
  }

  // Stop audio for inactive views
  if (view !== 'petri') petriRunning = false;
  if (view !== 'orbits') orbitsRunning = false;

  // Start audio for active view
  if (view === 'petri' && initialized) {
    petriRunning = true;
    petriTick();
    if (rebuildPetriBar) rebuildPetriBar();
  }
  if (view === 'orbits' && initialized) {
    orbitsRunning = true;
    orbitsTick();
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

function initPetri() {
  seedOrganisms();
}

function togglePetri() {
  petriRunning = !petriRunning;
  if (petriRunning) petriTick();
  if (rebuildPetriBar) rebuildPetriBar();
}

function petriTick() {
  if (!petriRunning) return;
  const events = tick(grid, petriConfig);
  petriAudio.syncCollisionConfig(petriConfig.collision);
  petriAudio.processEvents(events, grid.width);
  petriAudio.updateOrganisms(grid);
  petriRenderer.processEvents(events);
  setTimeout(petriTick, getTickInterval());
}

function petriRenderLoop() {
  if (currentView === 'petri') {
    petriRenderer.resize();
    petriRenderer.render(grid, petriConfig.bpm, petriAudio.playheadCol);
  }
  requestAnimationFrame(petriRenderLoop);
}

function seedOrganisms() {
  // Spread species to four corners so they don't immediately fight
  const corners = [
    { x: 5, y: 5 },    // top-left: species 0
    { x: 26, y: 5 },   // top-right: species 1
    { x: 5, y: 26 },   // bottom-left: species 2
    { x: 26, y: 26 },  // bottom-right: species 3
  ];
  for (let s = 0; s < 4; s++) {
    const cx = corners[s].x;
    const cy = corners[s].y;
    // Cluster of 5 with full energy
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const org = spawnOrganism(grid, cx + dx, cy + dy, s);
      if (org) org.energy = 80;
    }
  }
}

// --- Orbits ---


function orbitsTick() {
  if (!orbitsRunning) return;
  // Music tick at BPM rate
  orbitsMusic.tick(orbitsState, petriConfig.bpm);
  setTimeout(orbitsTick, Math.round(60000 / petriConfig.bpm / 2));
}

function orbitsRenderLoop() {
  if (currentView === 'orbits') {
    // Simulation runs every frame — fixed timestep handled internally
    if (orbitsRunning) {
      tickOrbits(orbitsState, 0.5);
    }
    orbitsRenderer.resize();
    orbitsRenderer.render(orbitsState, orbitsMusic.getCurrentChord());
  }
  requestAnimationFrame(orbitsRenderLoop);
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

    // Orbits
    const orbitsContainer = document.getElementById('orbits-container')!;
    orbitsState = createOrbitsState(800, 600);
    orbitsRenderer = new OrbitsRenderer(orbitsContainer);
    orbitsMusic = new OrbitsMusic();
    orbitsMusic.setPresetSource(() => synthEngine.getAllPresets());
    orbitsMusic.setBusSource(() => synthEngine.busEffects);
    await orbitsMusic.start();

    // Petri — wire synth presets as audio source
    grid = createGrid(GRID_SIZE, GRID_SIZE);
    petriAudio = new PetriAudio();
    petriAudio.setPresetSource(() => synthEngine.getAllPresets());
    petriAudio.setBusSource(() => synthEngine.busEffects);
    petriAudio.setMelodyConfig(melodyConfig);
    await petriAudio.start();
    const petriCanvas = document.getElementById('petri-canvas') as HTMLCanvasElement;
    petriRenderer = new PetriRenderer(petriCanvas);
    petriControls = new PetriControls();
    const petriBar = document.getElementById('petri-bar')!;
    rebuildPetriBar = () => petriControls.buildBottomBar(petriBar, petriConfig, petriRunning, togglePetri);
    rebuildPetriBar();
    initPetri();

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
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view') as 'synth' | 'petri' | 'orbits';
        if (view) showView(view);
      });
    });

    // Melody sidecart — always visible
    buildMelodyPanel(document.getElementById('melody-panel')!, melodyConfig, petriConfig, () => petriAudio.setMelodyConfig(melodyConfig));

    showView('orbits');
    orbitsRenderLoop();
    petriRenderLoop();
  });
}

init();
