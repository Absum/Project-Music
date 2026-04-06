import type { TidesState } from './simulation.js';
import type { AudioBus } from '../audio/bus.js';

// Markov chord progression
const CHORD_NOTES: Record<string, string[][]> = {
  'i':   [['C2','C3'], ['C3','Eb3','G3'], ['C4','Eb4','G4'], ['C5','Eb5','G5']],
  'iv':  [['F2','F3'], ['F3','Ab3','C4'], ['F4','Ab4','C5'], ['F5']],
  'v':   [['G2','G3'], ['G3','Bb3','D4'], ['G4','Bb4','D4'], ['G5','D5']],
  'VI':  [['Ab2','Ab3'], ['Ab3','C4','Eb4'], ['Ab4','C5','Eb5'], ['Ab5']],
  'III': [['Eb2','Eb3'], ['Eb3','G3','Bb3'], ['Eb4','G4','Bb4'], ['Eb5','G5']],
  'VII': [['Bb2','Bb3'], ['Bb3','D4','F4'], ['Bb4','D5','F5'], ['Bb5']],
};

const TRANSITIONS: Record<string, { next: string; weight: number }[]> = {
  'i':   [{ next: 'iv', weight: 3 }, { next: 'v', weight: 2 }, { next: 'VI', weight: 2 }, { next: 'III', weight: 1 }],
  'iv':  [{ next: 'i', weight: 2 }, { next: 'v', weight: 3 }, { next: 'VII', weight: 1 }],
  'v':   [{ next: 'i', weight: 4 }, { next: 'VI', weight: 2 }, { next: 'iv', weight: 1 }],
  'VI':  [{ next: 'III', weight: 3 }, { next: 'iv', weight: 2 }, { next: 'v', weight: 1 }],
  'III': [{ next: 'VI', weight: 2 }, { next: 'iv', weight: 2 }, { next: 'i', weight: 1 }],
  'VII': [{ next: 'III', weight: 2 }, { next: 'i', weight: 2 }, { next: 'v', weight: 1 }],
};

function nextChord(current: string): string {
  const options = TRANSITIONS[current] ?? TRANSITIONS['i'];
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const opt of options) { r -= opt.weight; if (r <= 0) return opt.next; }
  return options[0].next;
}

// 4 regions → preset indices: BASS=0, PAD=1, LEAD=2, ARP=3
const REGION_PRESETS = [0, 1, 2, 3];

interface RegionState {
  lastHeight: number;
  lastNoteIndex: number;
}

export class TidesMusic {
  private bus: AudioBus;
  private regionStates: RegionState[] = [];
  private currentChord = 'i';
  private chordTimer = 0;
  private chordInterval = 24;
  private tickCount = 0;

  constructor(bus: AudioBus) {
    this.bus = bus;
    for (let i = 0; i < 4; i++) {
      this.regionStates.push({ lastHeight: 0, lastNoteIndex: 0 });
    }
  }

  tick(state: TidesState): void {
    this.tickCount++;

    // Chord progression driven by wave energy
    this.chordTimer++;
    this.chordInterval = Math.max(8, Math.round(28 - state.totalEnergy * 40));
    if (this.chordTimer >= this.chordInterval) {
      this.chordTimer = 0;
      this.currentChord = nextChord(this.currentChord);
    }

    // Kick on wave energy
    if (this.tickCount % 2 === 0 && state.totalEnergy > 0.15) {
      this.bus.play(4, 'C2', '8n');
    }

    // Process each region
    for (let r = 0; r < 4; r++) {
      const rs = this.regionStates[r];
      const height = state.regionHeights[r];
      const delta = state.regionDeltas[r];

      const wasPositive = rs.lastHeight > 0;
      const isPositive = height > 0;
      const zeroCrossing = wasPositive !== isPositive;
      const wasPeak = rs.lastHeight > height && delta < 0 && height > 0.05;
      rs.lastHeight = height;

      const wavefrontTrigger = Math.abs(delta) > 0.001;
      const concentrationTrigger = Math.abs(height) > 0.1 && Math.random() < Math.abs(height) * 0.4;
      const periodicTrigger = Math.abs(height) > 0.05 && (this.tickCount + r * 3) % Math.max(2, Math.round(8 - Math.abs(height) * 6)) === 0;

      if (!wavefrontTrigger && !concentrationTrigger && !periodicTrigger && !zeroCrossing && !wasPeak) continue;

      const presetIdx = REGION_PRESETS[r];
      const panX = r % 2 === 0 ? -0.4 : 0.4;
      const octaveIndex = Math.min(3, Math.max(0, Math.floor((height + 0.5) * 3)));
      const chordNotes = CHORD_NOTES[this.currentChord]?.[octaveIndex];
      if (!chordNotes || chordNotes.length === 0) continue;

      let noteIndex: number;
      if (Math.random() < 0.65) {
        noteIndex = Math.max(0, Math.min(chordNotes.length - 1, rs.lastNoteIndex + (delta > 0 ? 1 : -1)));
      } else {
        noteIndex = Math.floor(Math.random() * chordNotes.length);
      }
      rs.lastNoteIndex = noteIndex;

      const absDelta = Math.abs(delta);
      const duration = absDelta > 0.02 ? '4n' : absDelta > 0.01 ? '8n' : '16n';

      this.bus.play(presetIdx, chordNotes[noteIndex], duration, panX);
    }
  }

  getCurrentChord(): string { return this.currentChord; }
}
