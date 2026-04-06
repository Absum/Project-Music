// Wave simulation — multiple sine waves creating interference patterns
// Inspired by absum.net's 4-layer parallax wave animation

export interface WaveLayer {
  freqX: number;     // spatial frequency in X
  freqZ: number;     // spatial frequency in Z
  speed: number;     // temporal speed
  amplitude: number; // height
  phase: number;     // phase offset
}

export interface TidesState {
  time: number;
  layers: WaveLayer[];
  // Per-region wave heights for music (4 quadrants)
  regionHeights: number[];
  regionDeltas: number[];
  totalEnergy: number;
}

export function createTidesState(): TidesState {
  // 4 wave layers with different frequencies — like the CSS parallax layers
  // but in 3D with X and Z directions
  const layers: WaveLayer[] = [
    // Very gentle, broad swells — like absum.net CSS waves
    { freqX: 0.3,  freqZ: 0.2,  speed: 0.15, amplitude: 0.12, phase: 0 },
    { freqX: 0.2,  freqZ: 0.35, speed: 0.12, amplitude: 0.10, phase: 1.2 },
    // Secondary gentle waves
    { freqX: 0.5,  freqZ: 0.4,  speed: 0.22, amplitude: 0.06, phase: 2.5 },
    { freqX: 0.4,  freqZ: 0.6,  speed: 0.18, amplitude: 0.05, phase: 3.8 },
    // Subtle surface movement
    { freqX: 0.9,  freqZ: 0.7,  speed: 0.35, amplitude: 0.025, phase: 0.7 },
    { freqX: 0.7,  freqZ: 1.0,  speed: 0.3,  amplitude: 0.02, phase: 4.1 },
    // Fine detail shimmer
    { freqX: 1.5,  freqZ: 1.2,  speed: 0.5,  amplitude: 0.008, phase: 1.9 },
    { freqX: 1.2,  freqZ: 1.8,  speed: 0.45, amplitude: 0.006, phase: 5.2 },
  ];

  return {
    time: 0,
    layers,
    regionHeights: [0, 0, 0, 0],
    regionDeltas: [0, 0, 0, 0],
    totalEnergy: 0,
  };
}

export function getWaveHeight(state: TidesState, x: number, z: number): number {
  let h = 0;
  for (const layer of state.layers) {
    h += layer.amplitude * Math.sin(
      x * layer.freqX + z * layer.freqZ + state.time * layer.speed + layer.phase
    );
  }
  return h;
}

export function tickTides(state: TidesState, dt: number): void {
  state.time += dt;

  // Slowly evolve wave parameters for organic variation
  for (let i = 0; i < state.layers.length; i++) {
    const layer = state.layers[i];
    // Gentle frequency drift
    layer.freqX += Math.sin(state.time * 0.1 + i * 1.7) * 0.001;
    layer.freqZ += Math.cos(state.time * 0.08 + i * 2.3) * 0.001;
    // Gentle amplitude breathing
    layer.amplitude *= 1 + Math.sin(state.time * 0.15 + i * 1.1) * 0.002;
    // Clamp amplitude
    const baseAmp = i < 2 ? 0.11 : i < 4 ? 0.055 : i < 6 ? 0.022 : 0.007;
    layer.amplitude = Math.max(baseAmp * 0.5, Math.min(baseAmp * 1.5, layer.amplitude));
  }

  // Sample wave heights at 4 region centers for music
  const prevHeights = [...state.regionHeights];
  const regionPoints = [
    { x: -2, z: -2 }, // quadrant 0: front-left
    { x:  2, z: -2 }, // quadrant 1: front-right
    { x: -2, z:  2 }, // quadrant 2: back-left
    { x:  2, z:  2 }, // quadrant 3: back-right
  ];

  let totalH = 0;
  for (let r = 0; r < 4; r++) {
    const h = getWaveHeight(state, regionPoints[r].x, regionPoints[r].z);
    state.regionHeights[r] = h;
    state.regionDeltas[r] = h - prevHeights[r];
    totalH += Math.abs(h);
  }
  state.totalEnergy = totalH / 4;
}
