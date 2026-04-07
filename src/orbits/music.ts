import type { Body, OrbitsState } from './simulation.js';
import { euclidean, getResonance } from './simulation.js';
import type { AudioBus } from '../audio/bus.js';
import type { MelodyEngine } from '../audio/melody.js';

interface BodyMusicState {
  lastNoteIndex: number;
  cooldown: number;
  euclideanK: number;
  euclideanN: number;
  mutateTimer: number;
}

export class OrbitsMusic {
  private bus: AudioBus;
  private melody: MelodyEngine;
  private bodyStates: Map<number, BodyMusicState> = new Map();
  private tickCount = 0;
  private globalCooldown = 0;

  constructor(bus: AudioBus, melody: MelodyEngine) {
    this.bus = bus;
    this.melody = melody;
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
    let minDist = Infinity;
    for (let i = 1; i < state.bodies.length; i++) {
      for (let j = i + 1; j < state.bodies.length; j++) {
        const a = state.bodies[i], b = state.bodies[j];
        const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
        if (d < minDist) minDist = d;
      }
    }
    const proximityFactor = Math.max(0, 1 - minDist / 400);
    this.melody.setChordInterval(Math.round(48 - proximityFactor * 32));
    this.melody.advanceChord();

    // Resonance → faster chord changes
    for (let i = 1; i < state.bodies.length; i++) {
      for (let j = i + 1; j < state.bodies.length; j++) {
        if (getResonance(state.bodies[i], state.bodies[j]) > 0.85) {
          this.melody.forceChordChange();
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
      if (!pattern[step]) continue;
      const stepId = Math.floor(body.phase * bs.euclideanN * 100);
      if (stepId === body.lastTrigger) continue;
      body.lastTrigger = stepId;

      // Rest probability
      if (Math.random() < 0.05 + (1 - state.energy) * 0.1) continue;

      // Cooldowns
      if (bs.cooldown > 0) { bs.cooldown--; continue; }
      if (this.globalCooldown > 0 && body.role !== 'kick' && body.role !== 'bass') continue;

      const pan = body.x / 400;

      if (body.role === 'kick') {
        this.bus.play(4, this.melody.getKickPitch(), '8n', pan);
        this.globalCooldown = 1;
        continue;
      }

      const dist = Math.sqrt(body.x ** 2 + body.y ** 2 + body.z ** 2);
      const octaveIndex = Math.min(this.melody.getOctaveCount() - 1, Math.floor(dist / 120));

      const { note, noteIndex } = this.melody.pickNote(octaveIndex, bs.lastNoteIndex);
      bs.lastNoteIndex = noteIndex;

      const duration = this.melody.getDuration(body.presetIndex);
      this.bus.play(body.presetIndex, note, duration, pan);

      bs.cooldown = body.role === 'pad' ? 1 : 0;
      this.globalCooldown = 0;
    }
  }

  getCurrentChord(): string { return this.melody.currentChord; }
}
