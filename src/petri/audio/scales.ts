import type { ScaleType, RootNote } from '../types.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALE_INTERVALS: Record<ScaleType, number[]> = {
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

const ROOT_SEMITONES: Record<RootNote, number> = {
  'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
  'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11,
};

export const SCALE_TYPES: ScaleType[] = [
  'minorPentatonic', 'majorPentatonic', 'minor', 'major',
  'chromatic', 'blues', 'dorian', 'mixolydian', 'phrygian', 'harmonicMinor',
];

export const SCALE_LABELS: Record<ScaleType, string> = {
  minorPentatonic: 'MIN PENT',
  majorPentatonic: 'MAJ PENT',
  minor: 'MINOR',
  major: 'MAJOR',
  chromatic: 'CHROMATIC',
  blues: 'BLUES',
  dorian: 'DORIAN',
  mixolydian: 'MIXOLYDIAN',
  phrygian: 'PHRYGIAN',
  harmonicMinor: 'HARM MIN',
};

export const ROOT_NOTES: RootNote[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function buildPitchMap(rootNote: RootNote, scaleType: ScaleType, octaveLow: number, octaveHigh: number, gridHeight: number): string[] {
  const rootSemitone = ROOT_SEMITONES[rootNote];
  const intervals = SCALE_INTERVALS[scaleType];

  // Generate all notes in scale across octave range (high to low for top=high)
  const allNotes: string[] = [];
  for (let oct = octaveHigh; oct >= octaveLow; oct--) {
    for (const interval of intervals) {
      const semitone = (rootSemitone + interval) % 12;
      const noteName = NOTE_NAMES[semitone];
      const noteOctave = oct + Math.floor((rootSemitone + interval) / 12);
      if (noteOctave > octaveHigh) continue;
      allNotes.push(`${noteName}${noteOctave}`);
    }
  }

  if (allNotes.length === 0) return new Array(gridHeight).fill('C3');

  // Distribute notes across grid rows
  const pitchMap: string[] = [];
  for (let row = 0; row < gridHeight; row++) {
    const index = Math.floor((row / gridHeight) * allNotes.length);
    pitchMap.push(allNotes[Math.min(index, allNotes.length - 1)]);
  }

  return pitchMap;
}
