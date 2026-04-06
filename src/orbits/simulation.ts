export interface Body {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
  mass: number;
  fixed: boolean;
  role: 'center' | 'kick' | 'bass' | 'pad' | 'lead' | 'arp';
  presetIndex: number;
  loopBeats: number;
  color: string;
  trail: { x: number; y: number; z: number }[];
  phase: number;
  lastTrigger: number;
  euclideanK: number;
  euclideanN: number;
}

export interface OrbitsState {
  bodies: Body[];
  time: number;
  energy: number;
  G: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  accumulator: number;
}

const TRAIL_LENGTH = 800;
const PHYSICS_DT = 1 / 60;
const G = 1.0;
const SOFTENING_SQ = 15 * 15;
const DAMPING = 1.0; // no damping — Verlet conserves energy naturally

let nextId = 0;

const ROLE_CONFIGS: { role: Body['role']; presetIndex: number; bodyMass: number; loopBeats: number; euclideanK: number; euclideanN: number; color: string; radius: number; tiltAngle: number }[] = [
  { role: 'kick',  presetIndex: 4, bodyMass: 0.5, loopBeats: 8,  euclideanK: 3, euclideanN: 8,  color: '#C74167', radius: 80,  tiltAngle: 0.1 },
  { role: 'bass',  presetIndex: 0, bodyMass: 0.5, loopBeats: 16, euclideanK: 4, euclideanN: 16, color: '#419EC7', radius: 160, tiltAngle: 0.25 },
  { role: 'pad',   presetIndex: 1, bodyMass: 0.5, loopBeats: 23, euclideanK: 3, euclideanN: 8,  color: '#41C78A', radius: 260, tiltAngle: -0.15 },
  { role: 'lead',  presetIndex: 2, bodyMass: 0.5, loopBeats: 7,  euclideanK: 5, euclideanN: 7,  color: '#C7A041', radius: 380, tiltAngle: 0.35 },
  { role: 'arp',   presetIndex: 3, bodyMass: 0.5, loopBeats: 11, euclideanK: 7, euclideanN: 11, color: '#9B59B6', radius: 520, tiltAngle: -0.3 },
];

const CENTRAL_MASS = 1000;

export function createOrbitsState(_width: number, _height: number): OrbitsState {
  const bodies: Body[] = [];

  // Central attractor (fixed, invisible in music but drives gravity)
  bodies.push({
    id: nextId++,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0,
    mass: CENTRAL_MASS, fixed: true,
    role: 'center', presetIndex: -1, loopBeats: 0, color: '#419EC7',
    trail: [], phase: 0, lastTrigger: 0, euclideanK: 0, euclideanN: 0,
  });

  for (let i = 0; i < ROLE_CONFIGS.length; i++) {
    const cfg = ROLE_CONFIGS[i];
    const angle = (i / ROLE_CONFIGS.length) * Math.PI * 2 + Math.random() * 0.3;
    const r = cfg.radius;
    const tilt = cfg.tiltAngle;

    // Circular orbital velocity accounting for Plummer softening
    const rSoft = Math.sqrt(r * r + SOFTENING_SQ);
    const v = Math.sqrt(G * CENTRAL_MASS * r * r / (rSoft * rSoft * rSoft));
    // Slight eccentricity for visual interest
    const eccFactor = 0.97 + Math.random() * 0.06;
    const vScaled = v * eccFactor;

    // Position on tilted orbital plane
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);

    bodies.push({
      id: nextId++,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * sinT,
      z: Math.sin(angle) * r * cosT,
      // Tangential velocity (perpendicular to radius, in tilted plane)
      vx: -Math.sin(angle) * vScaled,
      vy: Math.cos(angle) * vScaled * sinT,
      vz: Math.cos(angle) * vScaled * cosT,
      ax: 0, ay: 0, az: 0,
      mass: cfg.bodyMass, fixed: false,
      role: cfg.role, presetIndex: cfg.presetIndex,
      loopBeats: cfg.loopBeats, color: cfg.color,
      trail: [], phase: Math.random(), lastTrigger: 0,
      euclideanK: cfg.euclideanK, euclideanN: cfg.euclideanN,
    });
  }

  // Compute initial accelerations
  computeAccelerations(bodies);

  return { bodies, time: 0, energy: 0, G, centerX: 0, centerY: 0, centerZ: 0, accumulator: 0 };
}

function computeAccelerations(bodies: Body[]): void {
  for (const b of bodies) { b.ax = 0; b.ay = 0; b.az = 0; }

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;

      // Plummer softening: r^2 + eps^2
      const distSq = dx * dx + dy * dy + dz * dz + SOFTENING_SQ;
      const dist = Math.sqrt(distSq);
      const invDistCube = 1.0 / (dist * distSq);

      const fx = G * dx * invDistCube;
      const fy = G * dy * invDistCube;
      const fz = G * dz * invDistCube;

      if (!a.fixed) { a.ax += fx * b.mass; a.ay += fy * b.mass; a.az += fz * b.mass; }
      if (!b.fixed) { b.ax -= fx * a.mass; b.ay -= fy * a.mass; b.az -= fz * a.mass; }
    }
  }
}

function physicsStep(bodies: Body[]): void {
  const dt = PHYSICS_DT;

  // Velocity Verlet: half-step velocity
  for (const b of bodies) {
    if (b.fixed) continue;
    b.vx += b.ax * dt * 0.5;
    b.vy += b.ay * dt * 0.5;
    b.vz += b.az * dt * 0.5;
  }

  // Full-step position
  for (const b of bodies) {
    if (b.fixed) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
  }

  // Recompute accelerations from new positions
  computeAccelerations(bodies);

  // Half-step velocity with new accelerations + damping
  for (const b of bodies) {
    if (b.fixed) continue;
    b.vx += b.ax * dt * 0.5;
    b.vy += b.ay * dt * 0.5;
    b.vz += b.az * dt * 0.5;
    b.vx *= DAMPING;
    b.vy *= DAMPING;
    b.vz *= DAMPING;
  }

  // No orbital correction — pure Verlet should conserve energy
}

export function tickOrbits(state: OrbitsState, frameDelta: number): void {
  // Fixed timestep with accumulator
  state.accumulator += frameDelta;
  if (state.accumulator > 1.0) state.accumulator = 1.0;

  while (state.accumulator >= PHYSICS_DT) {
    physicsStep(state.bodies);
    state.accumulator -= PHYSICS_DT;
  }

  // Update trails and energy
  let totalKE = 0;
  for (const body of state.bodies) {
    if (body.fixed) continue;

    const speed = Math.sqrt(body.vx ** 2 + body.vy ** 2 + body.vz ** 2);
    totalKE += 0.5 * body.mass * speed * speed;

    // Trail — add point if moved enough
    const last = body.trail.length > 0 ? body.trail[body.trail.length - 1] : null;
    const moved = last ? Math.sqrt((body.x - last.x) ** 2 + (body.y - last.y) ** 2 + (body.z - last.z) ** 2) : Infinity;
    if (moved > 0.5) {
      body.trail.push({ x: body.x, y: body.y, z: body.z });
      if (body.trail.length > TRAIL_LENGTH) body.trail.shift();
    }
  }

  state.energy = Math.min(1, totalKE / 500);
  state.time += frameDelta;
}

export function getResonance(a: Body, b: Body): number {
  const distA = Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2);
  const distB = Math.sqrt(b.x ** 2 + b.y ** 2 + b.z ** 2);
  if (distA < 1 || distB < 1) return 0;
  const ratio = distA > distB ? distA / distB : distB / distA;
  const simpleRatios = [1, 1.5, 2, 2.5, 3];
  let bestMatch = 1;
  for (const r of simpleRatios) {
    if (Math.abs(ratio - r) < Math.abs(ratio - bestMatch)) bestMatch = r;
  }
  return 1 - Math.min(1, Math.abs(ratio - bestMatch) * 5);
}

export function euclidean(k: number, n: number): boolean[] {
  const pattern: boolean[] = new Array(n).fill(false);
  if (k <= 0 || k > n) return pattern;
  for (let i = 0; i < k; i++) {
    pattern[Math.floor((i * n) / k)] = true;
  }
  return pattern;
}
