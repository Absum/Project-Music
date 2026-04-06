import { SynthEngine } from './audio/engine.js';
import { setupKeyboard } from './ui/keyboard.js';
import { buildPresetSelector, buildSynthPanel, buildEffectsPanel, buildBusPanel } from './ui/controls.js';
import { Visualizer } from './ui/visualizer.js';

const engine = new SynthEngine();

function rebuildUI() {
  buildSynthPanel(
    document.getElementById('synth-col-left')!,
    document.getElementById('synth-col-right')!,
    engine,
  );
  buildEffectsPanel(document.getElementById('effects-panel')!, engine);
  buildBusPanel(document.getElementById('bus-panel')!, engine);
}

async function init() {
  const startBtn = document.getElementById('start-btn')!;
  const mainUI = document.getElementById('main-ui')!;

  startBtn.addEventListener('click', async () => {
    await engine.start();
    startBtn.parentElement!.classList.add('hidden');
    mainUI.classList.remove('hidden');

    const scopeCanvas = document.getElementById('scope') as HTMLCanvasElement;
    const viz = new Visualizer(scopeCanvas, engine);
    viz.start();

    const presetsEl = document.getElementById('presets')!;
    buildPresetSelector(presetsEl, engine, rebuildUI);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'preset-btn reset-btn';
    resetBtn.textContent = 'RESET';
    resetBtn.addEventListener('click', () => {
      engine.resetToFactory();
      buildPresetSelector(presetsEl, engine, rebuildUI);
      presetsEl.appendChild(resetBtn);
      rebuildUI();
    });
    presetsEl.appendChild(resetBtn);

    rebuildUI();

    setupKeyboard(
      document.getElementById('keyboard')!,
      (note) => engine.noteOn(note),
      (note) => engine.noteOff(note),
    );
  });
}

init();
