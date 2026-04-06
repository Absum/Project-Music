import type { Body, OrbitsState } from './simulation.js';
import { euclidean, getResonance } from './simulation.js';
import type { AudioBus } from '../audio/bus.js';

const CHORD_NOTES: Record<string, string[][]> = {
  'i':   [['C2','C3'], ['C3','Eb3','G3'], ['C4','Eb4','G4'], ['C5','Eb5','G5']],
  'iv':  [['F2','F3'], ['F3','Ab3','C4'], ['F4','Ab4','C5'], ['F5']],
  'v':   [['G2','G3'], ['G3','Bb3','D4'], ['G4','Bb4','D4'], ['G5','D5']],
  'VI':  [['Ab2','Ab3'], ['Ab3','C4','Eb4'], ['Ab4','C5','Eb5'], ['Ab5']],
  'III': [['Eb2','Eb3'], ['Eb3','G3','Bb3'], ['Eb4','G4','Bb4'], ['Eb5','G5']],
  'VII': [['Bb2','Bb3'], ['Bb3','D4','F4'], ['Bb4','D5','F5'], ['Bb5']],
  'ii':  [['D2','D3'], ['D3','F3','Ab3'], ['D4','F4','Ab4'], ['D5','F5']],
};

const TRANSITIONS: Record<string, { next: string; weight: number }[]> = {
  'i':   [{ next: 'iv', weight: 3 }, { next: 'v', weight: 2 }, { next: 'VI', weight: 2 }, { next: 'III', weight: 1 }],
  'iv':  [{ next: 'i', weight: 2 }, { next: 'v', weight: 3 }, { next: 'VII', weight: 1 }, { next: 'ii', weight: 1 }],
  'v':   [{ next: 'i', weight: 4 }, { next: 'VI', weight: 2 }, { next: 'iv', weight: 1 }],
  'VI':  [{ next: 'III', weight: 3 }, { next: 'iv', weight: 2 }, { next: 'v', weight: 1 }, { next: 'i', weight: 1 }],
  'III': [{ next: 'VI', weight: 2 }, { next: 'iv', weight: 2 }, { next: 'i', weight: 1 }, { next: 'VII', weight: 1 }],
  'VII': [{ next: 'III', weight: 2 }, { next: 'i', weight: 2 }, { next: 'v', weight: 1 }],
  'ii':  [{ next: 'v', weight: 3 }, { next: 'iv', weight: 1 }, { next: 'VII', weight: 1 }],
};

function nextChord(current: string): string {
  const options = TRANSITIONS[current] ?? TRANSITIONS['i'];
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const opt of options) { r -= opt.weight; if (r <= 0) return opt.next; }
  return options[0].next;
}

interface BodyMusicState {
  lastNoteIndex: number;
  cooldown: number;
  euclideanK: number;
  euclideanN: number;
  mutateTimer: number;
}

export class OrbitsMusic {
  private bus: AudioBus;
  private bodyStates: Map<number, BodyMusicState> = new Map();
  private currentChord = 'i';
  private chordTimer = 0;
  private chordInterval = 32;
  private tickCount = 0;
  private globalCooldown = 0;

  constructor(bus: AudioBus) {
    this.bus = bus;
  }

  private getBodyState(body: Body): BodyMusicState {
    let s = this.bodyStates.get(body.id);
    if (!s) {
      s = {
        lastNoteIndex: 0, cooldown: 0,
        euclideanK: body.euclideanK, euclideanN: body.euclideanN,
        mutateTimer: 40 + Math.floor(Math.random() * 40),
      };
      this.bodyStates.set(body.id, s);
    }
    return s;
  }

  tick(state: OrbitsState, _bpm: number): void {
    this.tickCount++;

    // Chord progression — proximity driven
    this.chordTimer++;
    let minDist = Infinity;
    for (let i = 1; i < state.bodies.length; i++) {
      for (let j = i + 1; j < state.bodies.length; j++) {
        const a = state.bodies[i], b = state.bodies[j];
        const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
        if (d < minDist) minDist = d;
      }
    }
    const proximityFactor = Math.max(0, 1 - minDist / 400);
    this.chordInterval = Math.round(48 - proximityFactor * 32);
    if (this.chordTimer >= this.chordInterval) {
      this.chordTimer = 0;
      this.currentChord = nextChord(this.currentChord);
    }

    // Resonance → faster chord changes
    for (let i = 1; i < state.bodies.length; i++) {
      for (let j = i + 1; j < state.bodies.length; j++) {
        const res = getResonance(state.bodies[i], state.bodies[j]);
        if (res > 0.85 && this.chordTimer > this.chordInterval * 0.6) {
          this.chordTimer = this.chordInterval;
        }
      }
    }

    if (this.globalCooldown > 0) this.globalCooldown--;

    for (const body of state.bodies) {
      if (body.role === 'center') continue;
      const bs = this.getBodyState(body);

      // Euclidean pattern evolution
      bs.mutateTimer--;
      if (bs.mutateTimer <= 0) {
        if (Math.random() < 0.5) {
          bs.euclideanK = Math.max(1, Math.min(bs.euclideanN - 1, bs.euclideanK + (Math.random() < 0.5 ? 1 : -1)));
        } else {
          bs.euclideanN = Math.max(bs.euclideanK + 1, Math.min(16, bs.euclideanN + (Math.random() < 0.5 ? 1 : -1)));
        }
        bs.mutateTimer = 30 + Math.floor(Math.random() * 50);
      }

      body.phase += 1 / body.loopBeats;
      if (body.phase >= 1) body.phase -= 1;

      const step = Math.floor(body.phase * bs.euclideanN);
      const pattern = euclidean(bs.euclideanK, bs.euclideanN);
      const shouldPlay = pattern[step];
      const stepId = Math.floor(body.phase * bs.euclideanN * 100);
      if (!shouldPlay || stepId === body.lastTrigger) continue;
      body.lastTrigger = stepId;

      const speed = Math.sqrt(body.vx ** 2 + body.vy ** 2 + body.vz ** 2);
      const dist = Math.sqrt(body.x ** 2 + body.y ** 2 + body.z ** 2);

      // Rest probability
      const restChance = 0.05 + (1 - state.energy) * 0.1;
      if (Math.random() < restChance) continue;

      // Cooldowns
      if (bs.cooldown > 0) { bs.cooldown--; continue; }
      if (this.globalCooldown > 0 && body.role !== 'kick' && body.role !== 'bass') continue;

      const pan = body.x / 400;

      if (body.role === 'kick') {
        this.bus.play(4, 'C2', '8n', pan);
        this.globalCooldown = 1;
        continue;
      }

      const octaveIndex = Math.min(3, Math.floor(dist / 120));
      const chordNotes = CHORD_NOTES[this.currentChord]?.[octaveIndex];
      if (!chordNotes || chordNotes.length === 0) continue;

      // Melodic memory
      let noteIndex: number;
      if (Math.random() < 0.7) {
        const direction = Math.random() < 0.5 ? -1 : 1;
        noteIndex = Math.max(0, Math.min(chordNotes.length - 1, bs.lastNoteIndex + direction));
      } else if (Math.random() < 0.5) {
        noteIndex = Math.floor(Math.random() * chordNotes.length);
      } else {
        noteIndex = Math.min(bs.lastNoteIndex, chordNotes.length - 1);
      }
      bs.lastNoteIndex = noteIndex;

      const speedFactor = Math.max(0.5, Math.min(2, speed * 0.8));
      let duration: string;
      if (body.role === 'pad') {
        duration = speedFactor < 0.8 ? '1n' : '2n';
      } else if (body.role === 'bass') {
        duration = speedFactor > 1.2 ? '8n' : '4n';
      } else if (body.role === 'arp') {
        duration = speedFactor > 1.5 ? '16n' : '8n';
      } else {
        duration = '8n';
      }

      this.bus.play(body.presetIndex, chordNotes[noteIndex], duration, pan);

      bs.cooldown = body.role === 'pad' ? 1 : 0;
      this.globalCooldown = 0;
    }
  }

  getCurrentChord(): string { return this.currentChord; }
}
