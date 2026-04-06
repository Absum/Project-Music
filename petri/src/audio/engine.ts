import * as Tone from 'tone';
import type { GridState, SimulationEvent } from '../types/index.js';

// C minor pentatonic per role octave
const BASS_SCALE  = ['C2', 'Eb2', 'F2', 'G2', 'Bb2'];
const PAD_SCALE   = ['C3', 'Eb3', 'F3', 'G3', 'Bb3'];
const ARP_SCALE   = ['C4', 'Eb4', 'F4', 'G4', 'Bb4'];
const LEAD_SCALE  = ['C4', 'Eb4', 'F4', 'G4', 'Bb4', 'C5', 'Eb5'];

const SEQ_LENGTH = 16;

// Consonant scale degrees (root=0, fifth=3) vs all
const CONSONANT_INDICES = [0, 2, 3]; // root, third, fifth in pentatonic
const ALL_INDICES = [0, 1, 2, 3, 4];

interface SeqStep {
  noteIndex: number; // index into the species' scale array
  velocity: number;  // 0–1
}

interface SpeciesSeq {
  steps: (SeqStep | null)[];
  position: number;   // current playback position
  lastAdded: number;  // last noteIndex added, for stepwise preference
}

interface OrgData {
  x: number;
  y: number;
  freq: number;
  energy: number;
  resourceRatio: number;
}

export class AudioEngine {
  // Synths — richer timbres
  private kickSynth!: Tone.MembraneSynth;
  private bassSynth!: Tone.FMSynth;
  private padSynth!: Tone.PolySynth;
  private leadSynth!: Tone.FMSynth;
  private arpSynth!: Tone.Synth;
  private noiseSynth!: Tone.NoiseSynth;

  // Effects — split into dry (bass/kick) and wet (pad/lead/arp) buses
  private dryBus!: Tone.Compressor;
  private wetBus!: Tone.Compressor;
  private reverb!: Tone.Reverb;
  private delay!: Tone.PingPongDelay;
  private chorus!: Tone.Chorus;
  private masterGain!: Tone.Gain;
  private leadFilter!: Tone.Filter;
  private bassFilter!: Tone.Filter;

  // Per-role gain + panner + shelf
  private kickGain!: Tone.Gain;
  private bassGain!: Tone.Gain;
  private padGain!: Tone.Gain;
  private leadGain!: Tone.Gain;
  private arpGain!: Tone.Gain;

  private bassPanner!: Tone.Panner;
  private padPanner!: Tone.Panner;
  private leadPanner!: Tone.Panner;
  private arpPanner!: Tone.Panner;

  private bassShelf!: Tone.Filter;
  private padShelf!: Tone.Filter;
  private leadShelf!: Tone.Filter;
  private arpShelf!: Tone.Filter;

  // Sequencers — one per species
  private sequences: SpeciesSeq[] = [];
  private globalBeat = 0;

  private initialized = false;
  private lastCollisionTime = 0;

  constructor() {
    // Init empty sequences
    for (let i = 0; i < 4; i++) {
      this.sequences.push({
        steps: new Array(SEQ_LENGTH).fill(null),
        position: 0,
        lastAdded: 0,
      });
    }
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    // Dry bus (bass + kick): compressor → master — tight, no reverb/delay
    this.dryBus = new Tone.Compressor(-14, 5);
    // Wet bus (pad + lead + arp): compressor → chorus → delay → reverb → master
    this.wetBus = new Tone.Compressor(-16, 4);
    this.delay = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.15, wet: 0.1 });
    this.chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.4, wet: 0.12 }).start();
    this.reverb = new Tone.Reverb({ decay: 1, wet: 0.5 });
    this.masterGain = new Tone.Gain(0.45);

    this.dryBus.connect(this.masterGain);
    this.wetBus.connect(this.delay);
    this.delay.connect(this.chorus);
    this.chorus.connect(this.reverb);
    this.reverb.connect(this.masterGain);
    this.masterGain.toDestination();

    // Kick + Bass → dry bus (no reverb/delay)
    this.kickGain = new Tone.Gain(0);
    this.kickGain.connect(this.dryBus);

    this.bassGain = new Tone.Gain(0);
    this.bassShelf = new Tone.Filter(2000, 'highshelf');
    this.bassPanner = new Tone.Panner(0);
    this.bassGain.connect(this.bassShelf);
    this.bassShelf.connect(this.bassPanner);
    this.bassPanner.connect(this.dryBus);

    // Pad, Lead, Arp → wet bus (full effects)
    const wetGains = [new Tone.Gain(0), new Tone.Gain(0), new Tone.Gain(0)];
    const wetShelves = [0, 1, 2].map(() => new Tone.Filter(2000, 'highshelf'));
    const wetPanners = [0, 1, 2].map(() => new Tone.Panner(0));
    for (let i = 0; i < 3; i++) {
      wetGains[i].connect(wetShelves[i]);
      wetShelves[i].connect(wetPanners[i]);
      wetPanners[i].connect(this.wetBus);
    }
    [this.padGain, this.leadGain, this.arpGain] = wetGains;
    [this.padShelf, this.leadShelf, this.arpShelf] = wetShelves;
    [this.padPanner, this.leadPanner, this.arpPanner] = wetPanners;

    // Bass — FM synthesis for warm, rich low end
    this.bassFilter = new Tone.Filter(500, 'lowpass');
    this.bassSynth = new Tone.FMSynth({
      harmonicity: 1,
      modulationIndex: 2,
      oscillator: { type: 'sine' },
      modulation: { type: 'square' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.5 },
      modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.3 },
      volume: -12,
    });
    this.bassSynth.connect(this.bassFilter);
    this.bassFilter.connect(this.bassGain);

    // Pad — fat detuned oscillator for lush, wide sound
    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsine', spread: 30, count: 3 } as Tone.SynthOptions['oscillator'],
      envelope: { attack: 0.5, decay: 0.8, sustain: 0.7, release: 1.5 },
      volume: -16,
    });
    this.padSynth.connect(this.padGain);

    // Lead — FM synth for harmonic richness, filtered
    this.leadFilter = new Tone.Filter(2500, 'lowpass');
    this.leadSynth = new Tone.FMSynth({
      harmonicity: 3,
      modulationIndex: 4,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: { attack: 0.03, decay: 0.2, sustain: 0.3, release: 0.6 },
      modulationEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.2, release: 0.4 },
      volume: -14,
    });
    this.leadSynth.connect(this.leadFilter);
    this.leadFilter.connect(this.leadGain);

    // Arp — detuned triangle for shimmer
    this.arpSynth = new Tone.Synth({
      oscillator: { type: 'fattriangle', spread: 20, count: 2 } as Tone.SynthOptions['oscillator'],
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.3 },
      volume: -15,
    });
    this.arpSynth.connect(this.arpGain);

    // Kick
    this.kickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 6,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
      volume: -12,
    });
    this.kickSynth.connect(this.kickGain);

    // Collision
    this.noiseSynth = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
      volume: -20,
    });
    this.noiseSynth.connect(this.wetBus);

    this.initialized = true;
  }

  // --- Sequence manipulation (called from processEvents) ---

  processEvents(events: SimulationEvent[], gridWidth: number): void {
    if (!this.initialized) return;

    let collisions = 0;
    for (const event of events) {
      switch (event.type) {
        case 'birth':
          this.addNoteToSequence(event.organism.species, event.organism.params.frequency, event.organism.energy);
          break;
        case 'death':
          this.removeNoteFromSequence(event.organism.species);
          break;
        case 'collision':
          if (collisions < 2) {
            collisions++;
            this.onCollision(event, gridWidth);
          }
          break;
      }
    }
  }

  private addNoteToSequence(species: number, _freq: number, energy: number): void {
    const seq = this.sequences[species];
    const scale = [BASS_SCALE, PAD_SCALE, LEAD_SCALE, ARP_SCALE][species];

    // Determine note index — prefer stepwise motion from last added
    const energyRatio = energy / 100;
    const pool = energyRatio > 0.5 ? CONSONANT_INDICES : ALL_INDICES;

    let noteIndex: number;
    // Stepwise preference: pick from pool, closest to lastAdded ±1
    const candidates = pool.filter(i => i < scale.length);
    const preferred = candidates.filter(i => Math.abs(i - seq.lastAdded) <= 1);
    if (preferred.length > 0) {
      noteIndex = preferred[Math.floor(Math.random() * preferred.length)];
    } else {
      noteIndex = candidates[Math.floor(Math.random() * candidates.length)];
    }

    // Find best slot to place note
    const slot = this.findBestSlot(seq, species);
    if (slot === -1) {
      // Sequence full — mutate an existing note instead
      this.mutateRandomStep(seq, scale.length);
      return;
    }

    seq.steps[slot] = { noteIndex, velocity: 0.5 + energyRatio * 0.5 };
    seq.lastAdded = noteIndex;
  }

  private removeNoteFromSequence(species: number): void {
    const seq = this.sequences[species];
    // Remove a random filled slot
    const filled = seq.steps.map((s, i) => s ? i : -1).filter(i => i !== -1);
    if (filled.length === 0) return;
    const removeIdx = filled[Math.floor(Math.random() * filled.length)];
    seq.steps[removeIdx] = null;
  }

  private findBestSlot(seq: SpeciesSeq, species: number): number {
    const empty = seq.steps.map((s, i) => s === null ? i : -1).filter(i => i !== -1);
    if (empty.length === 0) return -1;

    // Species-specific slot preference
    switch (species) {
      case 2: {
        // Bass: prefer strong beats (0, 4, 8, 12), then (2, 6, 10, 14)
        const strong = empty.filter(i => i % 4 === 0);
        if (strong.length > 0) return strong[Math.floor(Math.random() * strong.length)];
        const medium = empty.filter(i => i % 2 === 0);
        if (medium.length > 0) return medium[Math.floor(Math.random() * medium.length)];
        return empty[Math.floor(Math.random() * empty.length)];
      }
      case 0: {
        // Pad: prefer every 4th step for sustained chords
        const chord = empty.filter(i => i % 4 === 0);
        if (chord.length > 0) return chord[Math.floor(Math.random() * chord.length)];
        return empty[Math.floor(Math.random() * empty.length)];
      }
      case 1: {
        // Lead: prefer steps adjacent to existing notes for melodic continuity
        const filled = new Set(seq.steps.map((s, i) => s ? i : -1).filter(i => i !== -1));
        const adjacent = empty.filter(i => filled.has((i - 1 + SEQ_LENGTH) % SEQ_LENGTH) || filled.has((i + 1) % SEQ_LENGTH));
        if (adjacent.length > 0) return adjacent[Math.floor(Math.random() * adjacent.length)];
        return empty[Math.floor(Math.random() * empty.length)];
      }
      default:
        // Arp: fill sequentially
        return empty[0];
    }
  }

  private mutateRandomStep(seq: SpeciesSeq, scaleLength: number): void {
    const filled = seq.steps.map((s, i) => s ? i : -1).filter(i => i !== -1);
    if (filled.length === 0) return;
    const idx = filled[Math.floor(Math.random() * filled.length)];
    const step = seq.steps[idx]!;
    // Drift note index by ±1
    const drift = Math.random() < 0.5 ? -1 : 1;
    step.noteIndex = Math.max(0, Math.min(scaleLength - 1, step.noteIndex + drift));
  }

  // --- Playback + spatial (called each simulation tick) ---

  updateOrganisms(grid: GridState): void {
    if (!this.initialized) return;

    // Gather per-species spatial data
    const species: OrgData[][] = [[], [], [], []];
    let total = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y][x];
        if (!cell.organism) continue;
        const org = cell.organism;
        species[org.species].push({
          x: org.x, y: org.y,
          freq: org.params.frequency,
          energy: org.energy,
          resourceRatio: cell.resources / cell.maxResources,
        });
        total++;
      }
    }

    const now = Tone.now();
    const gw = grid.width;
    const gh = grid.height;
    const maxPop = 40;

    // --- Spatial: centroid + spread per species ---
    const spatial = species.map(orgs => {
      if (orgs.length === 0) return { panX: 0, panY: 0.5, spread: 0 };
      const cx = orgs.reduce((s, o) => s + o.x, 0) / orgs.length;
      const cy = orgs.reduce((s, o) => s + o.y, 0) / orgs.length;
      const avgDist = orgs.reduce((s, o) => s + Math.sqrt((o.x - cx) ** 2 + (o.y - cy) ** 2), 0) / orgs.length;
      return {
        panX: (cx / gw) * 2 - 1,
        panY: cy / gh,
        spread: Math.min(1, avgDist / (gw * 0.4)),
      };
    });

    // Apply spatial
    this.bassPanner.pan.rampTo(spatial[2].panX, 0.15);
    this.padPanner.pan.rampTo(spatial[0].panX, 0.15);
    this.leadPanner.pan.rampTo(spatial[1].panX, 0.15);
    this.arpPanner.pan.rampTo(spatial[3].panX, 0.15);

    this.bassShelf.gain.rampTo(6 - spatial[2].panY * 18, 0.15);
    this.padShelf.gain.rampTo(6 - spatial[0].panY * 18, 0.15);
    this.leadShelf.gain.rampTo(6 - spatial[1].panY * 18, 0.15);
    this.arpShelf.gain.rampTo(6 - spatial[3].panY * 18, 0.15);

    const avgSpread = spatial.reduce((s, sp) => s + sp.spread, 0) / 4;
    const totalDensity = Math.min(1, total / 100);
    this.reverb.wet.rampTo(0.12 + avgSpread * 0.15 + (1 - totalDensity) * 0.13, 0.3);
    this.delay.feedback.rampTo(0.08 + avgSpread * 0.12, 0.3);

    // --- Gains based on population ---
    const pops = species.map(s => Math.min(1, s.length / maxPop));
    this.kickGain.gain.rampTo(total > 0 ? 0.3 + totalDensity * 0.7 : 0, 0.1);
    this.bassGain.gain.rampTo(pops[2] > 0 ? 0.2 + pops[2] * 0.8 : 0, 0.1);
    this.padGain.gain.rampTo(pops[0] > 0 ? 0.2 + pops[0] * 0.8 : 0, 0.1);
    this.leadGain.gain.rampTo(pops[1] > 0 ? 0.2 + pops[1] * 0.8 : 0, 0.1);
    this.arpGain.gain.rampTo(pops[3] > 0 ? 0.2 + pops[3] * 0.8 : 0, 0.1);

    // --- Mutate sequences slowly based on average energy ---
    for (let s = 0; s < 4; s++) {
      if (species[s].length === 0) continue;
      const avgEnergy = species[s].reduce((sum, o) => sum + o.energy, 0) / species[s].length;
      // Lower energy = more mutations = more tension/movement
      if (Math.random() < (1 - avgEnergy / 100) * 0.3) {
        const scale = [BASS_SCALE, PAD_SCALE, LEAD_SCALE, ARP_SCALE][s];
        this.mutateRandomStep(this.sequences[s], scale.length);
      }
    }

    // --- Kick ---
    if (total > 0) {
      const kickEvery = total > 60 ? 1 : total > 30 ? 2 : 4;
      if (this.globalBeat % kickEvery === 0) {
        this.kickSynth.triggerAttackRelease('C1', '8n', now);
      }
    }

    // --- Play sequences ---
    const beat = this.globalBeat;

    // Bass (species 2): plays every 2nd beat from its sequence
    if (species[2].length > 0 && beat % 2 === 0) {
      const seqPos = this.sequences[2].position;
      const step = this.sequences[2].steps[seqPos];
      if (step) {
        const note = BASS_SCALE[step.noteIndex];
        const avgRes = this.avgResource(species[2]);
        this.bassFilter.frequency.rampTo(200 + avgRes * 300, 0.05);
        this.bassSynth.triggerAttackRelease(note, '4n', now);
      }
      this.sequences[2].position = (seqPos + 1) % SEQ_LENGTH;
    }

    // Pad (species 0): plays every 4th beat, gathers chord from current + next steps
    if (species[0].length > 0 && beat % 4 === 0) {
      const seq = this.sequences[0];
      const notes: string[] = [];
      // Collect up to 3 notes from current neighborhood in sequence
      for (let offset = 0; offset < 4 && notes.length < 3; offset++) {
        const step = seq.steps[(seq.position + offset) % SEQ_LENGTH];
        if (step) {
          const note = PAD_SCALE[step.noteIndex];
          if (!notes.includes(note)) notes.push(note);
        }
      }
      if (notes.length > 0) {
        this.padSynth.triggerAttackRelease(notes, '2n', now);
      }
      seq.position = (seq.position + 1) % SEQ_LENGTH;
    }

    // Lead (species 1): plays every beat, advances through its sequence
    if (species[1].length > 0) {
      const seq = this.sequences[1];
      const step = seq.steps[seq.position];
      if (step) {
        const note = LEAD_SCALE[step.noteIndex];
        const filterCut = 600 + pops[1] * 2500 + (step.velocity * 1000);
        this.leadFilter.frequency.rampTo(filterCut, 0.05);
        this.leadSynth.triggerAttackRelease(note, '8n', now + 0.02);
      }
      seq.position = (seq.position + 1) % SEQ_LENGTH;
    }

    // Arp (species 3): plays every beat, fast
    if (species[3].length > 0) {
      const seq = this.sequences[3];
      const step = seq.steps[seq.position];
      if (step) {
        const note = ARP_SCALE[step.noteIndex];
        this.arpSynth.triggerAttackRelease(note, '16n', now + 0.01);
      }
      seq.position = (seq.position + 1) % SEQ_LENGTH;

      // Double arp for large populations
      if (species[3].length > 15) {
        const step2 = seq.steps[seq.position];
        if (step2) {
          const note2 = ARP_SCALE[step2.noteIndex];
          this.arpSynth.triggerAttackRelease(note2, '16n', now + 0.08);
        }
      }
    }

    this.globalBeat = (this.globalBeat + 1) % (SEQ_LENGTH * 2);
  }

  private avgResource(orgs: OrgData[]): number {
    return orgs.reduce((s, o) => s + o.resourceRatio, 0) / orgs.length;
  }

  private onCollision(event: SimulationEvent, gridWidth: number): void {
    const pan = (event.x / gridWidth) * 2 - 1;
    const panner = new Tone.Panner(pan);
    this.noiseSynth.disconnect();
    this.noiseSynth.connect(panner);
    panner.connect(this.wetBus);

    const now = Tone.now();
    const startTime = Math.max(now, this.lastCollisionTime + 0.05);
    this.noiseSynth.triggerAttackRelease('32n', startTime);
    this.lastCollisionTime = startTime;
    setTimeout(() => panner.dispose(), 500);
  }

  dispose(): void {
    this.kickSynth.dispose();
    this.bassSynth.dispose();
    this.padSynth.dispose();
    this.leadSynth.dispose();
    this.arpSynth.dispose();
    this.noiseSynth.dispose();
    this.bassFilter.dispose();
    this.leadFilter.dispose();
    this.kickGain.dispose();
    this.bassGain.dispose();
    this.padGain.dispose();
    this.leadGain.dispose();
    this.arpGain.dispose();
    this.bassPanner.dispose();
    this.padPanner.dispose();
    this.leadPanner.dispose();
    this.arpPanner.dispose();
    this.bassShelf.dispose();
    this.padShelf.dispose();
    this.leadShelf.dispose();
    this.arpShelf.dispose();
    this.dryBus.dispose();
    this.wetBus.dispose();
    this.chorus.dispose();
    this.delay.dispose();
    this.reverb.dispose();
    this.masterGain.dispose();
  }
}
