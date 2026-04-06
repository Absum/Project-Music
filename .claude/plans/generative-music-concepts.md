# Generative Music Visualization Concepts

## Research Summary
The current petri dish piano roll system is too static — organisms placed by simulation dynamics produce essentially random scale tones with no harmonic awareness, no macro-structure, and no melodic memory. Good generative music needs: constraint over randomness, multiple timescales, tension-release arcs, harmonic movement, rhythmic anchoring with variation, and timbral evolution.

---

## Concept 1: ORBITS — Gravitational N-Body System (RECOMMENDED)

### Visual Metaphor
Dark cosmic void with luminous bodies orbiting each other under gravitational attraction. Bodies leave fading orbital trails (long-exposure astrophotography aesthetic). Bodies range from massive "stars" (kick, bass) to medium "planets" (pads, chords) to small "moons" (arps, leads). When bodies enter orbital resonance (period ratios like 2:1, 3:2), connecting filaments of light appear. System energy field expands during builds, contracts during breakdowns.

### Music Mapping
| Visual | Musical |
|--------|---------|
| Orbital period | Loop length (different lengths = Eno-style phase music) |
| Distance from center | Octave register (close = bass, far = treble) |
| Body mass/size | Volume and presence |
| Body color/hue | Timbre/preset |
| Orbital velocity | Note density / rhythm |
| Eccentricity | Swing/humanization |
| Orbital resonance | Harmonic consonance (chord tones together) |
| Distance between bodies | Stereo pan separation |
| Total kinetic energy | Master filter + FX wet |
| Gravitational collapse | Breakdowns |
| Bodies escaping orbit | Builds |

### Why It Sounds Good
- Phase music: different-length loops (7, 16, 23 beats) create patterns repeating only every LCM beats
- Orbital resonances → harmonic structure
- Elliptical orbits → non-uniform rhythmic patterns (Kepler's 2nd law)
- N-body chaos → never settles into fixed loops
- Gravitational expansion/contraction → natural builds and breakdowns

### Technical Approach
- N bodies with Verlet integration, gravitational force with softening
- Each body owns a Tone.Loop with orbital period as loop length
- Notes from Markov chain chord progression
- Euclidean rhythm generator per body
- Master filter + FX driven by system total energy

---

## Concept 2: TIDES — Reaction-Diffusion Fluid System

### Visual Metaphor
Living canvas of Gray-Scott reaction-diffusion patterns — spots, stripes, spirals, labyrinths. Looks like bioluminescent ocean from above. Instead of a single playhead, organic wavefronts of concentration ripple across the surface triggering notes.

### Music Mapping
| Visual | Musical |
|--------|---------|
| Chemical A concentration | Note velocity |
| Chemical B concentration | Filter cutoff |
| Pattern type (spots/stripes/labyrinth) | Chord voicing |
| Wave direction | Stereo pan |
| Feed rate | Harmonic density |
| Kill rate | Rhythmic density |
| Total concentration | Master energy |
| Bifurcation events | Chord changes |
| Spots | Staccato notes |
| Stripes | Sustained pads |
| Spirals | Rhythmic loops |

### Why It Sounds Good
- Phase transitions between pattern regimes = natural section changes
- Multiple wavefronts = distributed polyrhythmic triggers
- Continuous concentration values = smooth filter/FX automation
- Self-organizing harmony from quantized regions

### Technical Notes
- Needs WebGL for GPU-accelerated 256x256+ grid
- Gray-Scott parameters f (feed) and k (kill) slowly modulated
- Canvas divided into regions assigned to musical voices

---

## Concept 3: FLOCK — Boids/Swarm Intelligence

### Visual Metaphor
Hundreds of luminous particles following flocking rules (separation, alignment, cohesion). Different flocks = different instruments. Murmurations form, merge, split, swirl. Perlin noise "wind" pushes flocks into new formations.

### Music Mapping
| Visual | Musical |
|--------|---------|
| Flock centroid Y | Pitch register |
| Flock centroid X | Stereo pan |
| Flock cohesion | Chord voicing (tight = close, spread = open) |
| Flock velocity | Rhythm density |
| Flock size | Volume / layers |
| Inter-flock distance | Harmonic relationship |
| Individual deviation | Note humanization |
| Flock splitting | Call-and-response |
| Flock merging | Chord resolution |
| Wind direction change | Key/mode changes |

### Why It Sounds Good
- Simple rules → infinitely varied group behavior
- Natural alternation between tight (sparse) and dispersed (dense) states
- Multiple interacting flocks = musical counterpoint
- Very interactive (attractor/repulsor with mouse)

### Technical Notes
- 200-400 boids, 4-6 species
- Spatial hashing for O(n) neighbor lookup
- Perlin noise flow field
- Delaunay triangulation for flock mesh rendering

---

## Sources
- Brian Eno's Music for Airports (prime-length tape loops)
- Tero Parviainen's JavaScript Systems Music
- TRAPPIST-1 Sonification (orbital mechanics → music)
- Craig Reynolds' Boids algorithm
- Gray-Scott reaction-diffusion model
- GEDMAS (Generative Electronic Dance Music Algorithmic System)
- Euclidean rhythm algorithms (Bjorklund)
- Markov chain chord progression techniques
