import type { Cell, GridState, Organism, OrganismParams, SimulationConfig, SimulationEvent } from '../types.js';
import { SPECIES_PRESETS } from './species.js';

let nextId = 1;

export function createGrid(width: number, height: number): GridState {
  const cells: Cell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({
        organism: null,
        resources: 90 + Math.random() * 10,
        maxResources: 100,
        wall: false,
      });
    }
    cells.push(row);
  }
  return { width, height, cells, tick: 0 };
}

function mutateParams(params: OrganismParams, rate: number): OrganismParams {
  const drift = (value: number, range: number) =>
    Math.max(0, value + (Math.random() - 0.5) * range * rate);

  return {
    waveform: params.waveform,
    frequency: Math.max(40, Math.min(2000, drift(params.frequency, 100))),
    filterCutoff: Math.max(200, Math.min(8000, drift(params.filterCutoff, 500))),
    attack: Math.max(0.001, Math.min(1, drift(params.attack, 0.1))),
    decay: Math.max(0.01, Math.min(1, drift(params.decay, 0.1))),
    sustain: Math.max(0, Math.min(1, drift(params.sustain, 0.2))),
    release: Math.max(0.01, Math.min(2, drift(params.release, 0.2))),
  };
}

export function spawnOrganism(grid: GridState, x: number, y: number, species: number): Organism | null {
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return null;
  if (grid.cells[y][x].organism) return null;

  const preset = SPECIES_PRESETS[species];
  const organism: Organism = {
    id: nextId++,
    species,
    age: 0,
    energy: 60,
    maxEnergy: 100,
    params: { ...preset.params },
    x,
    y,
    birthTick: grid.tick,
  };

  grid.cells[y][x].organism = organism;
  return organism;
}

const NEIGHBOR_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

export function tick(grid: GridState, config: SimulationConfig): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const births: { x: number; y: number; parent: Organism }[] = [];
  const deaths: Organism[] = [];

  // Phase 0: Gravity drift — organisms slide toward gravity point
  if (config.gravity) {
    const gx = config.gravity.x;
    const gy = config.gravity.y;
    // Sort organisms by distance to gravity point (farthest first)
    const orgs: { x: number; y: number; dist: number }[] = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.cells[y][x].organism && !grid.cells[y][x].wall) {
          const dx = gx - x;
          const dy = gy - y;
          orgs.push({ x, y, dist: dx * dx + dy * dy });
        }
      }
    }
    orgs.sort((a, b) => b.dist - a.dist);
    for (const o of orgs) {
      if (!grid.cells[o.y][o.x].organism) continue;
      const dx = Math.sign(gx - o.x);
      const dy = Math.sign(gy - o.y);
      if (dx === 0 && dy === 0) continue;
      const nx = o.x + dx;
      const ny = o.y + dy;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;
      const target = grid.cells[ny][nx];
      if (!target.organism && !target.wall && Math.random() < 0.3) {
        const org = grid.cells[o.y][o.x].organism!;
        target.organism = org;
        org.x = nx;
        org.y = ny;
        grid.cells[o.y][o.x].organism = null;
      }
    }
  }

  // Phase 1: Consume resources, age, check for death
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.cells[y][x];
      if (!cell.organism) continue;

      const org = cell.organism;
      const preset = SPECIES_PRESETS[org.species];
      const consumption = 5 / preset.energyEfficiency;
      const energyGain = 2 + 1.5 * preset.energyEfficiency;

      if (cell.resources >= consumption) {
        cell.resources -= consumption;
        org.energy = Math.min(org.maxEnergy, org.energy + energyGain);
      } else {
        org.energy -= 5;
      }

      org.age++;

      if (org.energy <= 0) {
        deaths.push(org);
      }
    }
  }

  // Phase 2: Reproduction attempts
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.cells[y][x];
      if (!cell.organism) continue;

      const org = cell.organism;
      const preset = SPECIES_PRESETS[org.species];

      if (org.energy >= preset.reproductionCost && Math.random() < (config.reproductionProbability ?? 0.3)) {
        const shuffled = [...NEIGHBOR_OFFSETS].sort(() => Math.random() - 0.5);
        for (const [dx, dy] of shuffled) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

          const target = grid.cells[ny][nx];
          if (target.wall) continue;
          if (!target.organism) {
            births.push({ x: nx, y: ny, parent: org });
            org.energy -= preset.reproductionCost;
            break;
          } else if (target.organism.species !== org.species) {
            const defender = target.organism;
            // Grace period — young organisms can't be attacked
            if (defender.age < (config.gracePeriodTicks ?? 5)) break;
            // Probabilistic combat — higher energy = better odds, but not guaranteed
            const winChance = org.energy / (org.energy + defender.energy);
            org.energy -= 10; // combat costs energy regardless
            if (Math.random() < winChance) {
              events.push({
                type: 'collision',
                x: nx, y: ny,
                organism: org,
                opponent: defender,
                tick: grid.tick,
              });
              deaths.push(defender);
              births.push({ x: nx, y: ny, parent: org });
              org.energy -= preset.reproductionCost;
            }
            break;
          }
        }
      }
    }
  }

  // Phase 3: Apply deaths
  for (const org of deaths) {
    const cell = grid.cells[org.y][org.x];
    if (cell.organism?.id === org.id) {
      cell.organism = null;
      cell.resources = Math.min(cell.maxResources, cell.resources + 25);
      events.push({ type: 'death', x: org.x, y: org.y, organism: org, tick: grid.tick });
    }
  }

  // Phase 4: Apply births
  for (const birth of births) {
    const cell = grid.cells[birth.y][birth.x];
    if (!cell.organism) {
      const child: Organism = {
        id: nextId++,
        species: birth.parent.species,
        age: 0,
        energy: 40,
        maxEnergy: 100,
        params: mutateParams(birth.parent.params, config.mutationRate),
        x: birth.x,
        y: birth.y,
        birthTick: grid.tick,
      };
      cell.organism = child;
      events.push({ type: 'birth', x: birth.x, y: birth.y, organism: child, tick: grid.tick });
    }
  }

  // Phase 5: Resource regeneration
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.cells[y][x];
      if (!cell.organism) {
        cell.resources = Math.min(cell.maxResources, cell.resources + config.resourceRegenRate);
      }
    }
  }

  // Phase 6: Auto-spawn — keep diversity alive
  if (config.autoSpawn) {
    const counts = [0, 0, 0, 0];
    let total = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const org = grid.cells[y][x].organism;
        if (org) { counts[org.species]++; total++; }
      }
    }
    const avgCount = Math.max(1, total / 4);
    for (let s = 0; s < 4; s++) {
      const threshold = Math.max(5, avgCount * 0.4);
      if (counts[s] < threshold) {
        // Find best spot: fewest enemies + most resources
        let bestX = -1, bestY = -1, bestScore = Infinity;
        for (let y = 2; y < grid.height - 2; y++) {
          for (let x = 2; x < grid.width - 2; x++) {
            if (grid.cells[y][x].organism || grid.cells[y][x].wall) continue;
            let enemyNear = 0;
            for (let dy = -3; dy <= 3; dy++) {
              for (let dx = -3; dx <= 3; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
                  const neighbor = grid.cells[ny][nx].organism;
                  if (neighbor && neighbor.species !== s) enemyNear++;
                }
              }
            }
            const score = enemyNear * 15 - grid.cells[y][x].resources;
            if (score < bestScore) { bestScore = score; bestX = x; bestY = y; }
          }
        }
        if (bestX < 0) continue;
        // Spawn a cross cluster of 5 with grace period protection
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
          const sx = bestX + dx, sy = bestY + dy;
          if (sx >= 0 && sx < grid.width && sy >= 0 && sy < grid.height &&
              !grid.cells[sy][sx].organism && !grid.cells[sy][sx].wall) {
            const child = spawnOrganism(grid, sx, sy, s);
            if (child) {
              child.energy = 80;
              events.push({ type: 'birth', x: sx, y: sy, organism: child, tick: grid.tick });
            }
          }
        }
      }
    }
  }

  grid.tick++;
  return events;
}

export function floodResources(grid: GridState, cx: number, cy: number, radius: number): void {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        grid.cells[y][x].resources = grid.cells[y][x].maxResources;
      }
    }
  }
}

export function plague(grid: GridState, cx: number, cy: number, radius: number): void {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const cell = grid.cells[y][x];
        if (cell.organism) {
          cell.organism = null;
          cell.resources = Math.min(cell.maxResources, cell.resources + 15);
        }
      }
    }
  }
}

export function mutateRegion(grid: GridState, cx: number, cy: number, radius: number): void {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius && grid.cells[y][x].organism) {
        grid.cells[y][x].organism!.params = mutateParams(grid.cells[y][x].organism!.params, 1.5);
      }
    }
  }
}

export function toggleWall(grid: GridState, x: number, y: number): void {
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return;
  const cell = grid.cells[y][x];
  cell.wall = !cell.wall;
  if (cell.wall) cell.organism = null;
}

export function earthquake(grid: GridState): void {
  const organisms: Organism[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.cells[y][x].organism) {
        organisms.push(grid.cells[y][x].organism!);
        grid.cells[y][x].organism = null;
      }
    }
  }
  // Shuffle into random empty non-wall cells
  const empty: { x: number; y: number }[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (!grid.cells[y][x].organism && !grid.cells[y][x].wall) {
        empty.push({ x, y });
      }
    }
  }
  // Fisher-Yates shuffle
  for (let i = empty.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [empty[i], empty[j]] = [empty[j], empty[i]];
  }
  for (let i = 0; i < organisms.length && i < empty.length; i++) {
    const org = organisms[i];
    const pos = empty[i];
    org.x = pos.x;
    org.y = pos.y;
    grid.cells[pos.y][pos.x].organism = org;
  }
}
