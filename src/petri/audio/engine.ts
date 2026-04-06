import * as Tone from 'tone';
import type { GridState, SimulationEvent } from '../types.js';
import type { SynthPreset } from '../../audio/presets.js';

// Species → synth preset index mapping
// 0 Oscillaris → PAD (index 1)
// 1 Sawtonis   → LEAD (index 2)
// 2 Quadrus    → BASS (index 0)
// 3 Triangula  → ARP (index 3)
const SPECIES_TO_PRESET = [1, 2, 0, 3];

const BASS_SCALE  = ['C2', 'Eb2', 'F2', 'G2', 'Bb2'];
const PAD_SCALE   = ['C3', 'Eb3', 'F3', 'G3', 'Bb3'];
const ARP_SCALE   = ['C4', 'Eb4', 'F4', 'G4', 'Bb4'];
const LEAD_SCALE  = ['C4', 'Eb4', 'F4', 'G4', 'Bb4', 'C5', 'Eb5'];
const SCALES = [PAD_SCALE, LEAD_SCALE, BASS_SCALE, ARP_SCALE]; // indexed by species

const SEQ_LENGTH = 16;
const CONSONANT_INDICES = [0, 2, 3];
const ALL_INDICES = [0, 1, 2, 3, 4];

interface SeqStep { noteIndex: number; velocity: number; }
interface SpeciesSeq { steps: (SeqStep | null)[]; position: number; lastAdded: number; }
interface OrgData { x: number; y: number; freq: number; energy: number; resourceRatio: number; }

// Snapshot of preset params to detect changes
interface PresetSnapshot {
  oscType: string; harmonicity: number; modulationIndex: number; modWaveform: string;
  envelope: string; modEnvelope: string; filterCutoff: number; filterQ: number;
  filterType: string; volume: number; spread: number; count: number;
}

export class AudioEngine {
  // 4 species voices — all FMSynth for real-time param sync
  private synths: (Tone.FMSynth | null)[] = [null, null, null, null];
  private filters: (Tone.Filter | null)[] = [null, null, null, null];
  private gains: Tone.Gain[] = [];
  private panners: Tone.Panner[] = [];
  private shelves: Tone.Filter[] = [];

  private kickSynth: Tone.FMSynth | null = null;
  private kickFilter: Tone.Filter | null = null;
  private lastKickSnapshot: PresetSnapshot | null = null;
  private noiseSynth!: Tone.NoiseSynth;

  private dryBus!: Tone.Compressor;
  private wetBus!: Tone.Compressor;
  private delay!: Tone.PingPongDelay;
  private chorus!: Tone.Chorus;
  private reverb!: Tone.Reverb;
  private masterGain!: Tone.Gain;
  private kickGain!: Tone.Gain;

  private sequences: SpeciesSeq[] = [];
  private globalBeat = 0;
  private initialized = false;
  private lastCollisionTime = 0;

  // Reference to synth engine for live preset reading
  private getPresets: (() => SynthPreset[]) | null = null;
  private lastSnapshots: (PresetSnapshot | null)[] = [null, null, null, null];

  constructor() {
    for (let i = 0; i < 4; i++) {
      this.sequences.push({ steps: new Array(SEQ_LENGTH).fill(null), position: 0, lastAdded: 0 });
    }
  }

  setPresetSource(fn: () => SynthPreset[]): void {
    this.getPresets = fn;
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    this.dryBus = new Tone.Compressor(-14, 5);
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

    // Kick → dry
    this.kickGain = new Tone.Gain(0);
    this.kickGain.connect(this.dryBus);
    this.rebuildKick();

    // 4 species voices
    for (let i = 0; i < 4; i++) {
      const gain = new Tone.Gain(0);
      const shelf = new Tone.Filter(2000, 'highshelf');
      const panner = new Tone.Panner(0);
      gain.connect(shelf);
      shelf.connect(panner);
      // Bass (species 2) → dry bus, others → wet bus
      panner.connect(i === 2 ? this.dryBus : this.wetBus);
      this.gains.push(gain);
      this.shelves.push(shelf);
      this.panners.push(panner);
    }

    // Collision
    this.noiseSynth = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
      volume: -20,
    });
    this.noiseSynth.connect(this.wetBus);

    // Build initial synths from presets
    this.rebuildAllSynths();
    this.initialized = true;
  }

  private getPresetForSpecies(species: number): SynthPreset | null {
    if (!this.getPresets) return null;
    const presets = this.getPresets();
    return presets[SPECIES_TO_PRESET[species]] ?? null;
  }

  private takeSnapshot(p: SynthPreset): PresetSnapshot {
    return {
      oscType: p.oscType, harmonicity: p.harmonicity, modulationIndex: p.modulationIndex,
      modWaveform: p.modWaveform, envelope: JSON.stringify(p.envelope),
      modEnvelope: JSON.stringify(p.modEnvelope), filterCutoff: p.filterCutoff,
      filterQ: p.filterQ, filterType: p.filterType, volume: p.volume,
      spread: p.spread, count: p.count,
    };
  }

  private snapshotChanged(a: PresetSnapshot | null, b: PresetSnapshot): boolean {
    if (!a) return true;
    return a.oscType !== b.oscType || a.harmonicity !== b.harmonicity ||
      a.modulationIndex !== b.modulationIndex || a.modWaveform !== b.modWaveform ||
      a.envelope !== b.envelope || a.modEnvelope !== b.modEnvelope ||
      a.filterCutoff !== b.filterCutoff || a.filterQ !== b.filterQ ||
      a.filterType !== b.filterType || a.volume !== b.volume ||
      a.spread !== b.spread || a.count !== b.count;
  }

  private rebuildAllSynths(): void {
    for (let i = 0; i < 4; i++) this.rebuildSynth(i);
    this.rebuildKick();
  }

  private rebuildKick(): void {
    this.kickSynth?.dispose();
    this.kickFilter?.dispose();

    const p = this.getPresets ? this.getPresets()[4] : null;
    if (!p) {
      this.kickFilter = new Tone.Filter(5000, 'lowpass');
      this.kickSynth = new Tone.FMSynth({
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 }, volume: -12,
      });
      this.kickSynth.connect(this.kickFilter);
      this.kickFilter.connect(this.kickGain);
      return;
    }

    this.kickFilter = new Tone.Filter({
      frequency: p.filterCutoff, type: p.filterType as BiquadFilterType,
      Q: p.filterQ, rolloff: (p.filterRolloff ?? -12) as Tone.FilterRollOff,
    });

    const isFat = p.oscType.startsWith('fat');
    const oscOptions: Record<string, unknown> = { type: p.oscType };
    if (isFat) { oscOptions.spread = p.spread; oscOptions.count = p.count; }

    this.kickSynth = new Tone.FMSynth({
      harmonicity: p.harmonicity, modulationIndex: p.modulationIndex,
      oscillator: oscOptions as Tone.FMSynthOptions['oscillator'],
      modulation: { type: p.modWaveform } as Tone.FMSynthOptions['modulation'],
      envelope: p.envelope, modulationEnvelope: p.modEnvelope,
      volume: p.volume,
    });

    this.kickSynth.connect(this.kickFilter);
    this.kickFilter.connect(this.kickGain);
    this.lastKickSnapshot = this.takeSnapshot(p);
  }

  private rebuildSynth(species: number): void {
    // Dispose old
    this.synths[species]?.dispose();
    this.filters[species]?.dispose();

    const p = this.getPresetForSpecies(species);
    if (!p) {
      // Fallback defaults
      this.filters[species] = new Tone.Filter(2000, 'lowpass');
      this.synths[species] = new Tone.FMSynth({ volume: -16 });
      this.synths[species]!.connect(this.filters[species]!);
      this.filters[species]!.connect(this.gains[species]);
      return;
    }

    this.filters[species] = new Tone.Filter({
      frequency: p.filterCutoff, type: p.filterType as BiquadFilterType,
      Q: p.filterQ, rolloff: (p.filterRolloff ?? -12) as Tone.FilterRollOff,
    });

    const isFat = p.oscType.startsWith('fat');
    const oscOptions: Record<string, unknown> = { type: p.oscType };
    if (isFat) { oscOptions.spread = p.spread; oscOptions.count = p.count; }

    this.synths[species] = new Tone.FMSynth({
      harmonicity: p.harmonicity, modulationIndex: p.modulationIndex,
      oscillator: oscOptions as Tone.FMSynthOptions['oscillator'],
      modulation: { type: p.modWaveform } as Tone.FMSynthOptions['modulation'],
      envelope: p.envelope, modulationEnvelope: p.modEnvelope,
      volume: p.volume,
    });

    this.synths[species]!.connect(this.filters[species]!);
    this.filters[species]!.connect(this.gains[species]);

    this.lastSnapshots[species] = this.takeSnapshot(p);
  }

  private syncFromPresets(): void {
    for (let i = 0; i < 4; i++) {
      const p = this.getPresetForSpecies(i);
      if (!p) continue;
      const snap = this.takeSnapshot(p);

      if (this.snapshotChanged(this.lastSnapshots[i], snap)) {
        // Structural change — full rebuild needed
        const needsRebuild = !this.lastSnapshots[i] ||
          snap.oscType !== this.lastSnapshots[i]!.oscType ||
          snap.modWaveform !== this.lastSnapshots[i]!.modWaveform ||
          snap.filterType !== this.lastSnapshots[i]!.filterType ||
          snap.spread !== this.lastSnapshots[i]!.spread ||
          snap.count !== this.lastSnapshots[i]!.count;

        if (needsRebuild) {
          this.rebuildSynth(i);
        } else {
          // Ramp continuous params
          const synth = this.synths[i];
          const filter = this.filters[i];
          if (synth) {
            synth.harmonicity.rampTo(p.harmonicity, 0.1);
            synth.modulationIndex.rampTo(p.modulationIndex, 0.1);
            synth.volume.rampTo(p.volume, 0.1);
            if ('envelope' in synth) {
              const env = synth.envelope as unknown as Record<string, unknown>;
              env.attack = p.envelope.attack;
              env.decay = p.envelope.decay;
              env.sustain = p.envelope.sustain;
              env.release = p.envelope.release;
            }
            const modEnv = synth.modulationEnvelope as unknown as Record<string, unknown>;
            modEnv.attack = p.modEnvelope.attack;
            modEnv.decay = p.modEnvelope.decay;
            modEnv.sustain = p.modEnvelope.sustain;
            modEnv.release = p.modEnvelope.release;
          }
          if (filter) {
            filter.frequency.rampTo(p.filterCutoff, 0.1);
            filter.Q.rampTo(p.filterQ, 0.1);
          }
          this.lastSnapshots[i] = snap;
        }
      }
    }

    // Sync kick from KICK preset (index 4)
    if (this.getPresets) {
      const kickPreset = this.getPresets()[4];
      if (kickPreset) {
        const snap = this.takeSnapshot(kickPreset);
        if (this.snapshotChanged(this.lastKickSnapshot, snap)) {
          const needsRebuild = !this.lastKickSnapshot ||
            snap.oscType !== this.lastKickSnapshot.oscType ||
            snap.modWaveform !== this.lastKickSnapshot.modWaveform ||
            snap.filterType !== this.lastKickSnapshot.filterType ||
            snap.spread !== this.lastKickSnapshot.spread ||
            snap.count !== this.lastKickSnapshot.count;
          if (needsRebuild) {
            this.rebuildKick();
          } else if (this.kickSynth && this.kickFilter) {
            this.kickSynth.harmonicity.rampTo(kickPreset.harmonicity, 0.1);
            this.kickSynth.modulationIndex.rampTo(kickPreset.modulationIndex, 0.1);
            this.kickSynth.volume.rampTo(kickPreset.volume, 0.1);
            const env = this.kickSynth.envelope as unknown as Record<string, unknown>;
            env.attack = kickPreset.envelope.attack; env.decay = kickPreset.envelope.decay;
            env.sustain = kickPreset.envelope.sustain; env.release = kickPreset.envelope.release;
            const modEnv = this.kickSynth.modulationEnvelope as unknown as Record<string, unknown>;
            modEnv.attack = kickPreset.modEnvelope.attack; modEnv.decay = kickPreset.modEnvelope.decay;
            modEnv.sustain = kickPreset.modEnvelope.sustain; modEnv.release = kickPreset.modEnvelope.release;
            this.kickFilter.frequency.rampTo(kickPreset.filterCutoff, 0.1);
            this.kickFilter.Q.rampTo(kickPreset.filterQ, 0.1);
            this.lastKickSnapshot = snap;
          }
        }
      }
    }
  }

  // --- Sequence manipulation ---

  processEvents(events: SimulationEvent[], gridWidth: number): void {
    if (!this.initialized) return;
    let collisions = 0;
    for (const event of events) {
      switch (event.type) {
        case 'birth':
          this.addNoteToSequence(event.organism.species, event.organism.energy);
          break;
        case 'death':
          this.removeNoteFromSequence(event.organism.species);
          break;
        case 'collision':
          if (collisions < 2) { collisions++; this.onCollision(event, gridWidth); }
          break;
      }
    }
  }

  private addNoteToSequence(species: number, energy: number): void {
    const seq = this.sequences[species];
    const scale = SCALES[species];
    const energyRatio = energy / 100;
    const pool = energyRatio > 0.5 ? CONSONANT_INDICES : ALL_INDICES;
    const candidates = pool.filter(i => i < scale.length);
    const preferred = candidates.filter(i => Math.abs(i - seq.lastAdded) <= 1);
    const noteIndex = preferred.length > 0
      ? preferred[Math.floor(Math.random() * preferred.length)]
      : candidates[Math.floor(Math.random() * candidates.length)];

    const slot = this.findBestSlot(seq, species);
    if (slot === -1) { this.mutateRandomStep(seq, scale.length); return; }
    seq.steps[slot] = { noteIndex, velocity: 0.5 + energyRatio * 0.5 };
    seq.lastAdded = noteIndex;
  }

  private removeNoteFromSequence(species: number): void {
    const seq = this.sequences[species];
    const filled = seq.steps.map((s, i) => s ? i : -1).filter(i => i !== -1);
    if (filled.length === 0) return;
    seq.steps[filled[Math.floor(Math.random() * filled.length)]] = null;
  }

  private findBestSlot(seq: SpeciesSeq, species: number): number {
    const empty = seq.steps.map((s, i) => s === null ? i : -1).filter(i => i !== -1);
    if (empty.length === 0) return -1;
    switch (species) {
      case 2: {
        const strong = empty.filter(i => i % 4 === 0);
        if (strong.length > 0) return strong[Math.floor(Math.random() * strong.length)];
        const medium = empty.filter(i => i % 2 === 0);
        if (medium.length > 0) return medium[Math.floor(Math.random() * medium.length)];
        return empty[Math.floor(Math.random() * empty.length)];
      }
      case 0: {
        const chord = empty.filter(i => i % 4 === 0);
        if (chord.length > 0) return chord[Math.floor(Math.random() * chord.length)];
        return empty[Math.floor(Math.random() * empty.length)];
      }
      case 1: {
        const filled = new Set(seq.steps.map((s, i) => s ? i : -1).filter(i => i !== -1));
        const adj = empty.filter(i => filled.has((i - 1 + SEQ_LENGTH) % SEQ_LENGTH) || filled.has((i + 1) % SEQ_LENGTH));
        if (adj.length > 0) return adj[Math.floor(Math.random() * adj.length)];
        return empty[Math.floor(Math.random() * empty.length)];
      }
      default: return empty[0];
    }
  }

  private mutateRandomStep(seq: SpeciesSeq, scaleLength: number): void {
    const filled = seq.steps.map((s, i) => s ? i : -1).filter(i => i !== -1);
    if (filled.length === 0) return;
    const idx = filled[Math.floor(Math.random() * filled.length)];
    const step = seq.steps[idx]!;
    step.noteIndex = Math.max(0, Math.min(scaleLength - 1, step.noteIndex + (Math.random() < 0.5 ? -1 : 1)));
  }

  // --- Playback ---

  updateOrganisms(grid: GridState): void {
    if (!this.initialized) return;

    // Sync from synth presets (real-time parameter changes)
    this.syncFromPresets();

    const species: OrgData[][] = [[], [], [], []];
    let total = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y][x];
        if (!cell.organism) continue;
        const org = cell.organism;
        species[org.species].push({ x: org.x, y: org.y, freq: org.params.frequency, energy: org.energy, resourceRatio: cell.resources / cell.maxResources });
        total++;
      }
    }

    const now = Tone.now();
    const gw = grid.width;
    const gh = grid.height;
    const maxPop = 40;

    // Spatial
    const spatial = species.map(orgs => {
      if (orgs.length === 0) return { panX: 0, panY: 0.5, spread: 0 };
      const cx = orgs.reduce((s, o) => s + o.x, 0) / orgs.length;
      const cy = orgs.reduce((s, o) => s + o.y, 0) / orgs.length;
      const avgDist = orgs.reduce((s, o) => s + Math.sqrt((o.x - cx) ** 2 + (o.y - cy) ** 2), 0) / orgs.length;
      return { panX: (cx / gw) * 2 - 1, panY: cy / gh, spread: Math.min(1, avgDist / (gw * 0.4)) };
    });

    for (let i = 0; i < 4; i++) {
      this.panners[i].pan.rampTo(spatial[i].panX, 0.15);
      this.shelves[i].gain.rampTo(6 - spatial[i].panY * 18, 0.15);
    }

    const avgSpread = spatial.reduce((s, sp) => s + sp.spread, 0) / 4;
    const totalDensity = Math.min(1, total / 100);
    this.reverb.wet.rampTo(0.12 + avgSpread * 0.15 + (1 - totalDensity) * 0.13, 0.3);
    this.delay.feedback.rampTo(0.08 + avgSpread * 0.12, 0.3);

    // Gains
    const pops = species.map(s => Math.min(1, s.length / maxPop));
    this.kickGain.gain.rampTo(total > 0 ? 1 : 0, 0.1);
    for (let i = 0; i < 4; i++) {
      this.gains[i].gain.rampTo(pops[i] > 0 ? 0.2 + pops[i] * 0.8 : 0, 0.1);
    }

    // Mutations
    for (let s = 0; s < 4; s++) {
      if (species[s].length === 0) continue;
      const avgEnergy = species[s].reduce((sum, o) => sum + o.energy, 0) / species[s].length;
      if (Math.random() < (1 - avgEnergy / 100) * 0.3) {
        this.mutateRandomStep(this.sequences[s], SCALES[s].length);
      }
    }

    // Kick — every other beat
    if (total > 0 && this.kickSynth && this.globalBeat % 2 === 0) {
      this.kickSynth.triggerAttackRelease('C2', '8n', now);
    }

    // Sequences
    const beat = this.globalBeat;

    // Bass (species 2): every 2nd beat
    if (species[2].length > 0 && beat % 2 === 0) {
      const seq = this.sequences[2];
      const step = seq.steps[seq.position];
      if (step && this.synths[2]) {
        this.synths[2].triggerAttackRelease(BASS_SCALE[step.noteIndex], '4n', now);
      }
      seq.position = (seq.position + 1) % SEQ_LENGTH;
    }

    // Pad (species 0): every 4th beat, chord
    if (species[0].length > 0 && beat % 4 === 0) {
      const seq = this.sequences[0];
      const notes: string[] = [];
      for (let offset = 0; offset < 4 && notes.length < 3; offset++) {
        const step = seq.steps[(seq.position + offset) % SEQ_LENGTH];
        if (step) {
          const note = PAD_SCALE[step.noteIndex];
          if (!notes.includes(note)) notes.push(note);
        }
      }
      if (notes.length > 0 && this.synths[0]) {
        // Pad plays single notes sequentially (FMSynth, not PolySynth)
        this.synths[0].triggerAttackRelease(notes[0], '2n', now);
      }
      seq.position = (seq.position + 1) % SEQ_LENGTH;
    }

    // Lead (species 1): every beat
    if (species[1].length > 0) {
      const seq = this.sequences[1];
      const step = seq.steps[seq.position];
      if (step && this.synths[1]) {
        this.synths[1].triggerAttackRelease(LEAD_SCALE[step.noteIndex], '8n', now + 0.02);
      }
      seq.position = (seq.position + 1) % SEQ_LENGTH;
    }

    // Arp (species 3): every beat
    if (species[3].length > 0) {
      const seq = this.sequences[3];
      const step = seq.steps[seq.position];
      if (step && this.synths[3]) {
        this.synths[3].triggerAttackRelease(ARP_SCALE[step.noteIndex], '16n', now + 0.01);
      }
      seq.position = (seq.position + 1) % SEQ_LENGTH;
    }

    this.globalBeat = (this.globalBeat + 1) % (SEQ_LENGTH * 2);
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
    for (const s of this.synths) s?.dispose();
    for (const f of this.filters) f?.dispose();
    for (const g of this.gains) g.dispose();
    for (const p of this.panners) p.dispose();
    for (const s of this.shelves) s.dispose();
    this.kickSynth?.dispose();
    this.kickFilter?.dispose();
    this.noiseSynth.dispose();
    this.kickGain.dispose();
    this.dryBus.dispose();
    this.wetBus.dispose();
    this.chorus.dispose();
    this.delay.dispose();
    this.reverb.dispose();
    this.masterGain.dispose();
  }
}
