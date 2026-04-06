import type { GridState, SimulationEvent } from '../types.js';
import { SPECIES_PRESETS } from '../simulation/species.js';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: string;
}

interface BirthEffect { x: number; y: number; color: string; progress: number; }
interface CollisionRipple { x: number; y: number; color1: string; color2: string; progress: number; }

// Species colors mapped to the new cyan scheme
const SPECIES_COLORS = ['#419EC7', '#C74167', '#41C78A', '#C7A041'];

export class PetriRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private birthEffects: BirthEffect[] = [];
  private collisionRipples: CollisionRipple[] = [];
  private time = 0;

  private lastW = 0;
  private lastH = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (rect.width === this.lastW && rect.height === this.lastH) return;
    this.lastW = rect.width;
    this.lastH = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  getColor(species: number): string {
    return SPECIES_COLORS[species] ?? SPECIES_PRESETS[species]?.color ?? '#419EC7';
  }

  processEvents(events: SimulationEvent[]): void {
    for (const event of events) {
      const color = this.getColor(event.organism.species);
      if (event.type === 'birth') {
        this.birthEffects.push({ x: event.x, y: event.y, color, progress: 0 });
      }
      if (event.type === 'death') {
        for (let i = 0; i < 8; i++) {
          this.particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, life: 1, maxLife: 1, color });
        }
      }
      if (event.type === 'collision') {
        const color2 = event.opponent ? this.getColor(event.opponent.species) : '#fff';
        this.collisionRipples.push({ x: event.x, y: event.y, color1: color, color2, progress: 0 });
        for (let i = 0; i < 12; i++) {
          this.particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, life: 1, maxLife: 1, color: i % 2 === 0 ? color : color2 });
        }
      }
    }
  }

  render(grid: GridState, bpm = 120): void {
    this.time += 0.016;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const ctx = this.ctx;

    const beatPhase = (this.time * bpm / 60) * Math.PI * 2;
    const cellW = w / grid.width;
    const cellH = h / grid.height;
    const cellSize = Math.min(cellW, cellH);

    // Background
    ctx.fillStyle = '#101118';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(65,158,199,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= grid.width; x++) {
      ctx.beginPath(); ctx.moveTo(x * cellW, 0); ctx.lineTo(x * cellW, h); ctx.stroke();
    }
    for (let y = 0; y <= grid.height; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * cellH); ctx.lineTo(w, y * cellH); ctx.stroke();
    }

    // Resource heat map
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y][x];
        const ratio = cell.resources / cell.maxResources;
        if (ratio < 0.5) {
          const alpha = (1 - ratio * 2) * 0.15;
          ctx.fillStyle = `rgba(8,8,14,${alpha})`;
          ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
        } else if (ratio > 0.8) {
          const alpha = (ratio - 0.8) * 0.1;
          ctx.fillStyle = `rgba(65,158,199,${alpha * 0.15})`;
          ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
        }
      }
    }

    // Tendrils
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y][x];
        if (!cell.organism) continue;
        const px = x * cellW + cellW / 2;
        const py = y * cellH + cellH / 2;
        const color = this.getColor(cell.organism.species);
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= grid.width || ny >= grid.height) continue;
          const neighbor = grid.cells[ny][nx];
          if (neighbor.organism && neighbor.organism.species === cell.organism.species) {
            const npx = nx * cellW + cellW / 2;
            const npy = ny * cellH + cellH / 2;
            ctx.beginPath();
            ctx.moveTo(px, py);
            const midX = (px + npx) / 2 + Math.sin(this.time * 2 + x) * 2;
            const midY = (py + npy) / 2 + Math.cos(this.time * 2 + y) * 2;
            ctx.quadraticCurveTo(midX, midY, npx, npy);
            ctx.strokeStyle = color + '25';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }

    // Organisms
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y][x];
        if (!cell.organism) continue;
        const org = cell.organism;
        const px = x * cellW + cellW / 2;
        const py = y * cellH + cellH / 2;
        const color = this.getColor(org.species);
        const energyRatio = org.energy / org.maxEnergy;
        const pulse = 1 + Math.sin(beatPhase + org.id * 0.3) * 0.15;
        const blobR = Math.min(cellSize * 0.38, 12) + Math.min(cellSize * 0.1, 4) * energyRatio * pulse;

        // Glow
        const glowR = blobR * 2;
        const glow = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        glow.addColorStop(0, color + '18');
        glow.addColorStop(1, color + '00');
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.arc(px, py, blobR, 0, Math.PI * 2);
        const body = ctx.createRadialGradient(px - blobR * 0.3, py - blobR * 0.3, 0, px, py, blobR);
        body.addColorStop(0, color);
        body.addColorStop(1, color + '66');
        ctx.fillStyle = body;
        ctx.fill();
      }
    }

    // Birth effects
    this.birthEffects = this.birthEffects.filter(b => b.progress < 1);
    for (const b of this.birthEffects) {
      b.progress += 0.04;
      const px = b.x * cellW + cellW / 2;
      const py = b.y * cellH + cellH / 2;
      const t = b.progress;
      const spread = Math.min(cellSize * 0.2, 8) * (t < 0.5 ? t * 2 : 1);
      const r = Math.min(cellSize * 0.2, 8) * (1 - t * 0.4);
      const alpha = t < 0.5 ? 0.6 : 0.6 * (1 - (t - 0.5) * 2);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.beginPath(); ctx.arc(px - spread, py, Math.max(0, r), 0, Math.PI * 2);
      ctx.fillStyle = b.color; ctx.fill();
      ctx.beginPath(); ctx.arc(px + spread, py, Math.max(0, r), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Collision ripples
    this.collisionRipples = this.collisionRipples.filter(r => r.progress < 1);
    for (const r of this.collisionRipples) {
      r.progress += 0.05;
      const px = r.x * cellW + cellW / 2;
      const py = r.y * cellH + cellH / 2;
      const t = r.progress;
      const rippleR = Math.min(cellSize * 0.5, 15) + t * Math.min(cellSize, 30);
      const alpha = Math.floor(0.5 * (1 - t) * 255).toString(16).padStart(2, '0');
      ctx.beginPath(); ctx.arc(px, py, rippleR, 0, Math.PI * 2);
      ctx.strokeStyle = r.color2 + alpha;
      ctx.lineWidth = 2 * (1 - t);
      ctx.stroke();
    }

    // Particles
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy; p.vx *= 0.98; p.vy *= 0.98; p.life -= 0.006;
      const px = p.x * cellW + cellW / 2;
      const py = p.y * cellH + cellH / 2;
      const alpha = Math.floor(Math.max(0, p.life) * 255).toString(16).padStart(2, '0');
      ctx.beginPath(); ctx.arc(px, py, Math.max(0, 2 * p.life), 0, Math.PI * 2);
      ctx.fillStyle = p.color + alpha; ctx.fill();
    }

    // Edge vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
    vg.addColorStop(0, 'transparent');
    vg.addColorStop(1, 'rgba(16,17,24,0.4)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  getCellFromPixel(px: number, py: number, grid: GridState): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const cellW = rect.width / grid.width;
    const cellH = rect.height / grid.height;
    const gx = Math.floor(px / cellW);
    const gy = Math.floor(py / cellH);
    if (gx < 0 || gx >= grid.width || gy < 0 || gy >= grid.height) return null;
    return { x: gx, y: gy };
  }
}
