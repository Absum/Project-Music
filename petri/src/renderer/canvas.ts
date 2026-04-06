import type { GridState, SimulationEvent } from '../types/index.js';
import { SPECIES_PRESETS } from '../simulation/species.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

interface BirthEffect {
  x: number;
  y: number;
  color: string;
  progress: number; // 0 → 1
}

interface CollisionRipple {
  x: number;
  y: number;
  color1: string;
  color2: string;
  progress: number; // 0 → 1
}

export class PetriRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private birthEffects: BirthEffect[] = [];
  private collisionRipples: CollisionRipple[] = [];
  private time = 0;
  private lastOriginX = 0;
  private lastOriginY = 0;
  private lastCellW = 0;
  private lastCellH = 0;
  private lastCx = 0;
  private lastCy = 0;
  private lastRadius = 0;

  getCtx(): CanvasRenderingContext2D { return this.ctx; }
  getDishLayout(): { cx: number; cy: number; radius: number; originX: number; originY: number; cellW: number; cellH: number } {
    return { cx: this.lastCx, cy: this.lastCy, radius: this.lastRadius, originX: this.lastOriginX, originY: this.lastOriginY, cellW: this.lastCellW, cellH: this.lastCellH };
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.scale(dpr, dpr);
  }

  processEvents(events: SimulationEvent[]): void {
    for (const event of events) {
      if (event.type === 'birth') {
        const color = SPECIES_PRESETS[event.organism.species].color;
        this.birthEffects.push({ x: event.x, y: event.y, color, progress: 0 });
      }
      if (event.type === 'death') {
        const color = SPECIES_PRESETS[event.organism.species].color;
        for (let i = 0; i < 8; i++) {
          this.particles.push({
            x: event.x,
            y: event.y,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            life: 1,
            maxLife: 1,
            color,
          });
        }
      }
      if (event.type === 'collision') {
        const color1 = SPECIES_PRESETS[event.organism.species].color;
        const color2 = event.opponent ? SPECIES_PRESETS[event.opponent.species].color : '#fff';
        this.collisionRipples.push({ x: event.x, y: event.y, color1, color2, progress: 0 });
        for (let i = 0; i < 12; i++) {
          this.particles.push({
            x: event.x,
            y: event.y,
            vx: (Math.random() - 0.5) * 0.8,
            vy: (Math.random() - 0.5) * 0.8,
            life: 1,
            maxLife: 1,
            color: i % 2 === 0 ? color1 : color2,
          });
        }
      }
    }
  }

  render(grid: GridState, bpm = 120): void {
    this.time += 0.016;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ctx = this.ctx;

    // Count organisms for global intensity
    let organismCount = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.cells[y][x].organism) organismCount++;
      }
    }
    const density = Math.min(1, organismCount / 150);

    // Background
    ctx.fillStyle = '#08080e';
    ctx.fillRect(0, 0, w, h);

    // Petri dish circle
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.44;

    // Global intensity glow — dish resonates with population density
    const glowIntensity = density * 0.08;
    const glowPulse = 1 + Math.sin(this.time * (bpm / 60) * Math.PI * 2) * 0.3;
    const dishGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const gb = Math.floor(14 + glowIntensity * glowPulse * 40);
    const gg = Math.floor(16 + glowIntensity * glowPulse * 60);
    dishGrad.addColorStop(0, `rgb(${gb}, ${gg}, ${gb + 10})`);
    dishGrad.addColorStop(0.8, '#0a0c14');
    dishGrad.addColorStop(1, '#060810');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = dishGrad;
    ctx.fill();

    // Dish rim — brightness responds to population
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    const rimAlpha = 0.15 + density * 0.15;
    ctx.strokeStyle = `rgba(100, 200, 140, ${rimAlpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Beat phase for synced pulsing
    const beatPhase = (this.time * bpm / 60) * Math.PI * 2;

    const cellW = (radius * 2) / grid.width;
    const cellH = (radius * 2) / grid.height;
    const originX = cx - radius;
    const originY = cy - radius;

    // Resource heat map
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y][x];
        const px = originX + x * cellW + cellW / 2;
        const py = originY + y * cellH + cellH / 2;

        // Only render within the dish circle
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > radius * radius) continue;

        const resourceRatio = cell.resources / cell.maxResources;
        if (resourceRatio < 0.5) {
          // Filter sweep visualization — depleted areas dim and desaturate
          const scarcity = 1 - resourceRatio * 2; // 0 at 50%, 1 at 0%
          const alpha = scarcity * 0.2;
          ctx.fillStyle = `rgba(5, 5, 10, ${alpha})`;
          ctx.fillRect(originX + x * cellW, originY + y * cellH, cellW, cellH);
          // Desaturation overlay for severe depletion
          if (resourceRatio < 0.2) {
            const desatAlpha = (0.2 - resourceRatio) * 0.4;
            ctx.fillStyle = `rgba(15, 15, 18, ${desatAlpha})`;
            ctx.fillRect(originX + x * cellW, originY + y * cellH, cellW, cellH);
          }
        } else if (resourceRatio > 0.8) {
          const alpha = (resourceRatio - 0.8) * 0.15;
          ctx.fillStyle = `rgba(40, 80, 60, ${alpha})`;
          ctx.fillRect(originX + x * cellW, originY + y * cellH, cellW, cellH);
        }
      }
    }

    // Organism tendrils (connections between same species neighbors)
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y][x];
        if (!cell.organism) continue;

        const px = originX + x * cellW + cellW / 2;
        const py = originY + y * cellH + cellH / 2;
        const color = SPECIES_PRESETS[cell.organism.species].color;

        // Check right and down neighbors to avoid double-drawing
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= grid.width || ny >= grid.height) continue;
          const neighbor = grid.cells[ny][nx];
          if (neighbor.organism && neighbor.organism.species === cell.organism.species) {
            const npx = originX + nx * cellW + cellW / 2;
            const npy = originY + ny * cellH + cellH / 2;
            ctx.beginPath();
            ctx.moveTo(px, py);
            const midX = (px + npx) / 2 + Math.sin(this.time * 2 + x) * 2;
            const midY = (py + npy) / 2 + Math.cos(this.time * 2 + y) * 2;
            ctx.quadraticCurveTo(midX, midY, npx, npy);
            ctx.strokeStyle = color + '30';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }

    // Organisms as blobs
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y][x];
        if (!cell.organism) continue;

        const org = cell.organism;
        const px = originX + x * cellW + cellW / 2;
        const py = originY + y * cellH + cellH / 2;

        // Skip if outside dish
        const ddx = px - cx;
        const ddy = py - cy;
        if (ddx * ddx + ddy * ddy > radius * radius) continue;

        const preset = SPECIES_PRESETS[org.species];
        const energyRatio = org.energy / org.maxEnergy;

        // Beat-synced pulsing — all organisms pulse together on the beat
        const pulse = 1 + Math.sin(beatPhase + org.id * 0.3) * 0.15;
        const blobRadius = (cellW * 0.35 + cellW * 0.15 * energyRatio) * pulse;

        // Frequency → color shift: higher freq = warmer, lower = cooler
        const freqNorm = Math.max(0, Math.min(1, (org.params.frequency - 40) / 1960)); // 0–1
        const warmShift = Math.floor((freqNorm - 0.5) * 60);
        const color = this.shiftColor(preset.color, warmShift);

        // Waveform ripples — faint concentric rings shaped by waveform
        const rippleCount = 2;
        for (let r = 1; r <= rippleCount; r++) {
          const ripplePhase = (beatPhase * 0.5 + org.id * 0.5 + r * 1.5) % (Math.PI * 2);
          const rippleR = blobRadius * (1.5 + r * 0.8) + Math.sin(ripplePhase) * 2;
          const rippleAlpha = 0.06 * (1 - r / (rippleCount + 1)) * energyRatio;
          ctx.beginPath();
          // Waveform shape modulates the ripple
          if (org.params.waveform === 'square') {
            const half = rippleR * 0.7;
            ctx.rect(px - half, py - half, half * 2, half * 2);
          } else if (org.params.waveform === 'sawtooth') {
            ctx.moveTo(px, py - rippleR);
            ctx.lineTo(px + rippleR * 0.8, py + rippleR * 0.5);
            ctx.lineTo(px - rippleR * 0.8, py + rippleR * 0.5);
            ctx.closePath();
          } else {
            ctx.arc(px, py, rippleR, 0, Math.PI * 2);
          }
          ctx.strokeStyle = color + Math.floor(rippleAlpha * 255).toString(16).padStart(2, '0');
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Glow
        const glowGrad = ctx.createRadialGradient(px, py, 0, px, py, blobRadius * 2.5);
        glowGrad.addColorStop(0, color + '20');
        glowGrad.addColorStop(1, color + '00');
        ctx.beginPath();
        ctx.arc(px, py, blobRadius * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = glowGrad;
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.arc(px, py, blobRadius, 0, Math.PI * 2);
        const bodyGrad = ctx.createRadialGradient(px - blobRadius * 0.3, py - blobRadius * 0.3, 0, px, py, blobRadius);
        bodyGrad.addColorStop(0, color);
        bodyGrad.addColorStop(1, color + '88');
        ctx.fillStyle = bodyGrad;
        ctx.fill();
      }
    }

    // Birth animations — cell division pinch & split
    this.birthEffects = this.birthEffects.filter(b => b.progress < 1);
    for (const b of this.birthEffects) {
      b.progress += 0.04;
      const px = originX + b.x * cellW + cellW / 2;
      const py = originY + b.y * cellH + cellH / 2;
      const t = b.progress;

      if (t < 0.5) {
        // Pinch phase: draw two overlapping circles squeezing together
        const pinch = t * 2; // 0 → 1
        const spread = cellW * 0.2 * pinch;
        const r = cellW * 0.3 * (1 - pinch * 0.3);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(px - spread, py, r, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px + spread, py, r, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // Split phase: two blobs separate and fade
        const split = (t - 0.5) * 2; // 0 → 1
        const spread = cellW * (0.2 + 0.25 * split);
        const r = cellW * 0.22 * (1 - split * 0.5);
        const alpha = 0.6 * (1 - split);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(px - spread, py, Math.max(0, r), 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px + spread, py, Math.max(0, r), 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Collision flash — expanding ripple rings
    this.collisionRipples = this.collisionRipples.filter(r => r.progress < 1);
    for (const r of this.collisionRipples) {
      r.progress += 0.05;
      const px = originX + r.x * cellW + cellW / 2;
      const py = originY + r.y * cellH + cellH / 2;
      const t = r.progress;
      const rippleRadius = cellW * (0.5 + t * 2);
      const alpha = 0.5 * (1 - t);

      // Flash
      if (t < 0.15) {
        const flashAlpha = 0.4 * (1 - t / 0.15);
        const flashGrad = ctx.createRadialGradient(px, py, 0, px, py, cellW * 0.8);
        flashGrad.addColorStop(0, r.color1 + Math.floor(flashAlpha * 255).toString(16).padStart(2, '0'));
        flashGrad.addColorStop(1, r.color1 + '00');
        ctx.beginPath();
        ctx.arc(px, py, cellW * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = flashGrad;
        ctx.fill();
      }

      // Expanding ring
      ctx.beginPath();
      ctx.arc(px, py, rippleRadius, 0, Math.PI * 2);
      ctx.strokeStyle = r.color2 + Math.floor(alpha * 255).toString(16).padStart(2, '0');
      ctx.lineWidth = 2 * (1 - t);
      ctx.stroke();
    }

    // Particles — fade rate matched to reverb tail (~3 seconds at 60fps)
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= 0.006;

      const px = originX + p.x * cellW + cellW / 2;
      const py = originY + p.y * cellH + cellH / 2;
      const alpha = Math.floor(p.life * 255).toString(16).padStart(2, '0');
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0, 2 * p.life), 0, Math.PI * 2);
      ctx.fillStyle = p.color + alpha;
      ctx.fill();
    }

    // Walls — rendered after organisms, before vignette
    this.lastOriginX = originX;
    this.lastOriginY = originY;
    this.lastCellW = cellW;
    this.lastCellH = cellH;
    this.lastCx = cx;
    this.lastCy = cy;
    this.lastRadius = radius;

    // Vignette
    const vignetteGrad = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius * 1.2);
    vignetteGrad.addColorStop(0, 'transparent');
    vignetteGrad.addColorStop(1, '#08080e');
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, w, h);
  }

  private shiftColor(hex: string, shift: number): string {
    const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + shift));
    const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) - Math.abs(shift) * 0.3));
    const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) - shift));
    return `#${Math.floor(r).toString(16).padStart(2, '0')}${Math.floor(g).toString(16).padStart(2, '0')}${Math.floor(b).toString(16).padStart(2, '0')}`;
  }

  getCellFromPixel(px: number, py: number, grid: GridState): { x: number; y: number } | null {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.44;
    const originX = cx - radius;
    const originY = cy - radius;
    const cellW = (radius * 2) / grid.width;
    const cellH = (radius * 2) / grid.height;

    const gx = Math.floor((px - originX) / cellW);
    const gy = Math.floor((py - originY) / cellH);

    if (gx < 0 || gx >= grid.width || gy < 0 || gy >= grid.height) return null;

    const cellCx = originX + gx * cellW + cellW / 2;
    const cellCy = originY + gy * cellH + cellH / 2;
    const dx = cellCx - cx;
    const dy = cellCy - cy;
    if (dx * dx + dy * dy > radius * radius) return null;

    return { x: gx, y: gy };
  }
}
