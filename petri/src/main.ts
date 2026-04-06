import { createGrid, spawnOrganism, tick } from './simulation/grid.js';
import { AudioEngine } from './audio/engine.js';
import { PetriRenderer } from './renderer/canvas.js';
import { UIControls } from './ui/controls.js';
import { PRESETS, saveSnapshot, loadSnapshots, restoreSnapshot, encodeToURL, decodeFromURL, AudioRecorder } from './ui/sessions.js';
import type { GridState, SimulationConfig } from './types/index.js';

const GRID_SIZE = 32;

const config: SimulationConfig = {
  bpm: 120,
  mutationRate: 0.3,
  resourceRegenRate: 1.5,
  reproductionThreshold: 40,
  maxOrganisms: 200,
  gravity: null,
};

let grid: GridState;
let audioEngine: AudioEngine;
let renderer: PetriRenderer;
let ui: UIControls;
let recorder: AudioRecorder;
let running = false;

function getTickInterval(): number {
  return Math.round(60000 / config.bpm / 2);
}

function simulationTick() {
  if (!running) return;

  const events = tick(grid, config);
  audioEngine.processEvents(events, grid.width);
  audioEngine.updateOrganisms(grid);
  renderer.processEvents(events);

  setTimeout(simulationTick, getTickInterval());
}

function renderLoop() {
  renderer.render(grid, config.bpm);

  const layout = renderer.getDishLayout();
  const ctx = renderer.getCtx();
  ui.renderWalls(ctx, grid, layout.originX, layout.originY, layout.cellW, layout.cellH, layout.cx, layout.cy, layout.radius);
  ui.render(ctx, layout.cx, layout.cy, layout.radius);

  // Recording indicator
  if (recorder.isRecording()) {
    ctx.beginPath();
    ctx.arc(30, 30, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3333';
    ctx.fill();
  }

  requestAnimationFrame(renderLoop);
}

function getDishLayout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { cx: w / 2, cy: h / 2, radius: Math.min(w, h) * 0.44 };
}

function loadPreset(index: number) {
  const preset = PRESETS[index];
  if (!preset) return;
  grid = preset.apply(config);
  ui.syncFromConfig(config);
}

async function init() {
  const canvas = document.getElementById('petri-canvas') as HTMLCanvasElement;
  const overlay = document.getElementById('start-overlay')!;

  grid = createGrid(GRID_SIZE, GRID_SIZE);
  audioEngine = new AudioEngine();
  renderer = new PetriRenderer(canvas);
  ui = new UIControls();
  recorder = new AudioRecorder();
  ui.syncFromConfig(config);

  // Check for shared state in URL
  const sharedGrid = decodeFromURL(config);
  if (sharedGrid) {
    grid = sharedGrid;
    ui.syncFromConfig(config);
  }

  renderLoop();

  overlay.addEventListener('click', async () => {
    await audioEngine.start();
    overlay.classList.add('hidden');
    if (!sharedGrid) seedOrganisms();
    running = true;
    simulationTick();
  });

  // Mouse interactions
  canvas.addEventListener('click', (e) => {
    if (!running) return;
    const dish = getDishLayout();
    if (ui.handleClick(e.clientX, e.clientY, dish.cx, dish.cy, dish.radius)) return;

    const cell = renderer.getCellFromPixel(e.clientX, e.clientY, grid);
    if (cell) {
      ui.applyTool(grid, cell.x, cell.y, config);
    }
  });

  let painting = false;
  canvas.addEventListener('mousedown', (e) => {
    if (!running) return;
    const dish = getDishLayout();
    if (ui.handleDialDragStart(e.clientX, e.clientY, dish.cx, dish.cy, dish.radius)) return;
    painting = true;
  });

  canvas.addEventListener('mouseup', () => {
    painting = false;
    ui.handleDialDragEnd();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!running) return;
    const dish = getDishLayout();
    ui.handleMouseMove(e.clientX, e.clientY, dish.cx, dish.cy, dish.radius);

    if (ui.isDraggingDial()) {
      ui.handleDialDrag(e.clientY, config);
      return;
    }

    if (painting) {
      const cell = renderer.getCellFromPixel(e.clientX, e.clientY, grid);
      if (cell) {
        ui.applyTool(grid, cell.x, cell.y, config);
      }
    }
  });

  // Touch support
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!running) return;
    const touch = e.touches[0];
    const dish = getDishLayout();
    if (ui.handleClick(touch.clientX, touch.clientY, dish.cx, dish.cy, dish.radius)) return;
    if (ui.handleDialDragStart(touch.clientX, touch.clientY, dish.cx, dish.cy, dish.radius)) return;

    painting = true;
    const cell = renderer.getCellFromPixel(touch.clientX, touch.clientY, grid);
    if (cell) {
      ui.applyTool(grid, cell.x, cell.y, config);
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!running) return;
    const touch = e.touches[0];

    if (ui.isDraggingDial()) {
      ui.handleDialDrag(touch.clientY, config);
      return;
    }

    if (painting) {
      const cell = renderer.getCellFromPixel(touch.clientX, touch.clientY, grid);
      if (cell) {
        ui.applyTool(grid, cell.x, cell.y, config);
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    painting = false;
    ui.handleDialDragEnd();
  }, { passive: false });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (!running) return;

    // Presets: F1–F4
    if (e.key === 'F1') { e.preventDefault(); loadPreset(0); }
    if (e.key === 'F2') { e.preventDefault(); loadPreset(1); }
    if (e.key === 'F3') { e.preventDefault(); loadPreset(2); }
    if (e.key === 'F4') { e.preventDefault(); loadPreset(3); }

    // Save snapshot: Ctrl+S
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const name = `Snapshot ${new Date().toLocaleTimeString()}`;
      saveSnapshot(name, grid, config);
    }

    // Load last snapshot: Ctrl+L
    if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const snapshots = loadSnapshots();
      if (snapshots.length > 0) {
        grid = restoreSnapshot(snapshots[0], config);
        ui.syncFromConfig(config);
      }
    }

    // Share URL: Ctrl+Shift+S
    if (e.key === 'S' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      const url = encodeToURL(grid, config);
      navigator.clipboard.writeText(url);
    }

    // Toggle recording: R
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
      if (recorder.isRecording()) {
        recorder.stop();
      } else {
        recorder.start();
      }
    }
  });
}

function seedOrganisms() {
  const center = Math.floor(GRID_SIZE / 2);
  const offset = 5;

  for (let i = 0; i < 3; i++) {
    spawnOrganism(grid, center - offset + i, center - offset, 0);
    spawnOrganism(grid, center + offset - i, center - offset, 1);
    spawnOrganism(grid, center - offset + i, center + offset, 2);
    spawnOrganism(grid, center + offset - i, center + offset, 3);
  }
}

init();
