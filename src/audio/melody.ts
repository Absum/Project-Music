import type { MelodyConfig, NoteDuration } from '../petri/types.js';

// ═══ Scale definitions ═══

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALE_INTERVALS: Record<string, number[]> = {
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minor:          [0, 2, 3, 5, 7, 8, 10],
  major:          [0, 2, 4, 5, 7, 9, 11],
  chromatic:      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  blues:          [0, 3, 5, 6, 7, 10],
  dorian:         [0, 2, 3, 5, 7, 9, 10],
  mixolydian:     [0, 2, 4, 5, 7, 9, 10],
  phrygian:       [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor:  [0, 2, 3, 5, 7, 8, 11],
};

const ROOT_SEMITONES: Record<string, number> = {
  'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
  'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11,
};

// Chord degrees in the scale (indices into scale intervals)
// i=root, ii=2nd, iii/III=3rd, iv/IV=4th, v/V=5th, vi/VI=6th, vii/VII=7th
const CHORD_DEGREES: Record<string, number[]> = {
  'i':   [0, 2, 4],   // root triad
  'ii':  [1, 3, 5],
  'III': [2, 4, 6],
  'iv':  [3, 5, 0],
  'v':   [4, 6, 1],
  'VI':  [5, 0, 2],
  'VII': [6, 1, 3],
};

// Markov transition weights
const TRANSITIONS: Record<string, { next: string; weight: number }[]> = {
  'i':   [{ next: 'iv', weight: 3 }, { next: 'v', weight: 2 }, { next: 'VI', weight: 2 }, { next: 'III', weight: 1 }],
  'ii':  [{ next: 'v', weight: 3 }, { next: 'iv', weight: 1 }, { next: 'VII', weight: 1 }],
  'III': [{ next: 'VI', weight: 2 }, { next: 'iv', weight: 2 }, { next: 'i', weight: 1 }, { next: 'VII', weight: 1 }],
  'iv':  [{ next: 'i', weight: 2 }, { next: 'v', weight: 3 }, { next: 'VII', weight: 1 }, { next: 'ii', weight: 1 }],
  'v':   [{ next: 'i', weight: 4 }, { next: 'VI', weight: 2 }, { next: 'iv', weight: 1 }],
  'VI':  [{ next: 'III', weight: 3 }, { next: 'iv', weight: 2 }, { next: 'v', weight: 1 }, { next: 'i', weight: 1 }],
  'VII': [{ next: 'III', weight: 2 }, { next: 'i', weight: 2 }, { next: 'v', weight: 1 }],
};

// ═══ Melody Engine ═══

export class MelodyEngine {
  private config: MelodyConfig;
  private scaleNotes: string[][] = []; // notes per octave [octaveIndex][noteIndex]
  private chordCache: Map<string, string[][]> = new Map(); // chord → notes per octave

  // Chord state
  currentChord = 'i';
  chordTimer = 0;
  chordInterval = 24;

  constructor(config: MelodyConfig) {
    this.config = config;
    this.rebuildScale();
  }

  updateConfig(config: MelodyConfig): void {
    this.config = config;
    this.rebuildScale();
  }

  getConfig(): MelodyConfig {
    return this.config;
  }

  // ═══ Scale & Chord Generation ═══

  private rebuildScale(): void {
    const rootSemitone = ROOT_SEMITONES[this.config.rootNote] ?? 0;
    const intervals = SCALE_INTERVALS[this.config.scaleType] ?? SCALE_INTERVALS.minorPentatonic;

    this.scaleNotes = [];
    for (let oct = this.config.octaveLow; oct <= this.config.octaveHigh; oct++) {
      const octNotes: string[] = [];
      for (const interval of intervals) {
        const semitone = (rootSemitone + interval) % 12;
        const noteName = NOTE_NAMES[semitone];
        const noteOctave = oct + Math.floor((rootSemitone + interval) / 12);
        if (noteOctave >= this.config.octaveLow && noteOctave <= this.config.octaveHigh) {
          octNotes.push(`${noteName}${noteOctave}`);
        }
      }
      this.scaleNotes.push(octNotes);
    }

    // Rebuild chord cache
    this.chordCache.clear();
    for (const chordName of Object.keys(CHORD_DEGREES)) {
      this.chordCache.set(chordName, this.buildChordNotes(chordName));
    }
  }

  private buildChordNotes(chordName: string): string[][] {
    const degrees = CHORD_DEGREES[chordName];
    if (!degrees) return this.scaleNotes.map(() => []);

    const intervals = SCALE_INTERVALS[this.config.scaleType] ?? SCALE_INTERVALS.minorPentatonic;
    const rootSemitone = ROOT_SEMITONES[this.config.rootNote] ?? 0;
    const result: string[][] = [];

    for (let oct = this.config.octaveLow; oct <= this.config.octaveHigh; oct++) {
      const chordNotes: string[] = [];
      for (const degree of degrees) {
        const interval = intervals[degree % intervals.length];
        const semitone = (rootSemitone + interval) % 12;
        const noteName = NOTE_NAMES[semitone];
        const noteOctave = oct + Math.floor((rootSemitone + interval) / 12);
        const note = `${noteName}${noteOctave}`;
        if (!chordNotes.includes(note)) chordNotes.push(note);
      }
      result.push(chordNotes);
    }
    return result;
  }

  // ═══ Chord Progression ═══

  advanceChord(speed = 1): void {
    this.chordTimer += speed;
    if (this.chordTimer >= this.chordInterval) {
      this.chordTimer = 0;
      this.currentChord = this.nextChord();
    }
  }

  forceChordChange(): void {
    this.chordTimer = this.chordInterval;
  }

  setChordInterval(interval: number): void {
    this.chordInterval = Math.max(4, interval);
  }

  private nextChord(): string {
    const options = TRANSITIONS[this.currentChord] ?? TRANSITIONS['i'];
    const total = options.reduce((s, o) => s + o.weight, 0);
    let r = Math.random() * total;
    for (const opt of options) { r -= opt.weight; if (r <= 0) return opt.next; }
    return options[0].next;
  }

  // ═══ Note Selection ═══

  /** Get chord notes for the current chord at a given octave index (0 = lowest) */
  getChordNotes(octaveIndex: number): string[] {
    const notes = this.chordCache.get(this.currentChord);
    if (!notes) return [];
    const idx = Math.max(0, Math.min(notes.length - 1, octaveIndex));
    return notes[idx] ?? [];
  }

  /** Get the number of available octaves */
  getOctaveCount(): number {
    return this.config.octaveHigh - this.config.octaveLow + 1;
  }

  /** Pick a note using melodic memory (stepwise preference) */
  pickNote(octaveIndex: number, lastNoteIndex: number, delta = 0): { note: string; noteIndex: number } {
    const chordNotes = this.getChordNotes(octaveIndex);
    if (chordNotes.length === 0) return { note: 'C3', noteIndex: 0 };

    let noteIndex: number;
    if (Math.random() < 0.65) {
      // Stepwise: direction follows delta if provided
      const dir = delta !== 0 ? Math.sign(delta) : (Math.random() < 0.5 ? -1 : 1);
      noteIndex = Math.max(0, Math.min(chordNotes.length - 1, lastNoteIndex + dir));
    } else if (Math.random() < 0.5) {
      noteIndex = Math.floor(Math.random() * chordNotes.length);
    } else {
      noteIndex = Math.min(lastNoteIndex, chordNotes.length - 1);
    }

    return { note: chordNotes[noteIndex], noteIndex };
  }

  /** Build a pitch map for the grid (petri playhead) — maps row to note */
  buildPitchMap(gridHeight: number): string[] {
    // Flatten all scale notes from high to low
    const allNotes: string[] = [];
    for (let i = this.scaleNotes.length - 1; i >= 0; i--) {
      for (const note of this.scaleNotes[i]) {
        allNotes.push(note);
      }
    }
    if (allNotes.length === 0) return new Array(gridHeight).fill('C3');

    const pitchMap: string[] = [];
    for (let row = 0; row < gridHeight; row++) {
      const index = Math.floor((row / gridHeight) * allNotes.length);
      pitchMap.push(allNotes[Math.min(index, allNotes.length - 1)]);
    }
    return pitchMap;
  }

  // ═══ Duration & Kick helpers ═══

  getDuration(presetIndex: number): NoteDuration {
    // Map preset index to species index for duration lookup
    // Presets: 0=BASS, 1=PAD, 2=LEAD, 3=ARP, 4=KICK
    const speciesMap: Record<number, number> = { 0: 2, 1: 0, 2: 1, 3: 3 }; // preset → species
    const speciesIdx = speciesMap[presetIndex] ?? 0;
    return this.config.speciesDuration[speciesIdx] ?? '8n';
  }

  getKickDensity(): number { return this.config.kickDensity; }
  getKickPitch(): string { return this.config.kickPitch; }
}
