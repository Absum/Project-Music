import type { TidesState } from './simulation.js';
import type { AudioBus } from '../audio/bus.js';
import type { MelodyEngine } from '../audio/melody.js';

const REGION_PRESETS = [0, 1, 2, 3]; // BASS, PAD, LEAD, ARP

interface RegionState {
  lastHeight: number;
  lastNoteIndex: number;
}

export class TidesMusic {
  private bus: AudioBus;
  private melody: MelodyEngine;
  private regionStates: RegionState[] = [];
  private tickCount = 0;

  constructor(bus: AudioBus, melody: MelodyEngine) {
    this.bus = bus;
    this.melody = melody;
    for (let i = 0; i < 4; i++) {
      this.regionStates.push({ lastHeight: 0, lastNoteIndex: 0 });
    }
  }

  tick(state: TidesState): void {
    this.tickCount++;

    // Chord progression driven by wave energy
    this.melody.setChordInterval(Math.max(8, Math.round(28 - state.totalEnergy * 40)));
    this.melody.advanceChord();

    // Kick
    if (this.tickCount % this.melody.getKickDensity() === 0 && state.totalEnergy > 0.01) {
      this.bus.play(4, this.melody.getKickPitch(), '8n');
    }

    // Process each region
    for (let r = 0; r < 4; r++) {
      const rs = this.regionStates[r];
      const height = state.regionHeights[r];
      const delta = state.regionDeltas[r];

      const wasPositive = rs.lastHeight > 0;
      const isPositive = height > 0;
      const zeroCrossing = wasPositive !== isPositive;
      rs.lastHeight = height;

      const wavefrontTrigger = Math.abs(delta) > 0.001;
      const concentrationTrigger = Math.abs(height) > 0.1 && Math.random() < Math.abs(height) * 0.4;
      const periodicTrigger = Math.abs(height) > 0.05 && (this.tickCount + r * 3) % Math.max(2, Math.round(8 - Math.abs(height) * 6)) === 0;

      if (!wavefrontTrigger && !concentrationTrigger && !periodicTrigger && !zeroCrossing) continue;

      const presetIdx = REGION_PRESETS[r];
      const panX = r % 2 === 0 ? -0.4 : 0.4;
      const octaveIndex = Math.min(this.melody.getOctaveCount() - 1, Math.max(0, Math.floor((height + 0.5) * this.melody.getOctaveCount())));

      const { note, noteIndex } = this.melody.pickNote(octaveIndex, rs.lastNoteIndex, delta);
      rs.lastNoteIndex = noteIndex;

      const duration = this.melody.getDuration(presetIdx);
      this.bus.play(presetIdx, note, duration, panX);
    }
  }

  getCurrentChord(): string { return this.melody.currentChord; }
}
