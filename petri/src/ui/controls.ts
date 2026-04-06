import type { GridState, SimulationConfig } from '../types/index.js';
import { SPECIES_PRESETS } from '../simulation/species.js';
import { floodResources, plague, mutateRegion, earthquake, spawnOrganism } from '../simulation/grid.js';

export type Tool = 'place' | 'flood' | 'plague' | 'mutate' | 'earthquake';

interface Dial {
  label: string;
  key: keyof SimulationConfig;
  min: number;
  max: number;
  angle: number; // current normalized 0–1
  tooltip: string;
}

interface GodGlyph {
  tool: Tool;
  symbol: string;
  tooltip: string;
  color: string;
}

const GOD_GLYPHS: GodGlyph[] = [
  { tool: 'flood', symbol: '\u2614', tooltip: 'Flood — pour nutrients', color: '#44aadd' },
  { tool: 'plague', symbol: '\u2620', tooltip: 'Plague — kill organisms', color: '#dd4444' },
  { tool: 'mutate', symbol: '\u2622', tooltip: 'Mutate — force mutations', color: '#aa44dd' },
  { tool: 'earthquake', symbol: '\u2301', tooltip: 'Earthquake — shuffle all', color: '#ddaa44' },
];

export class UIControls {
  private selectedSpecies = 0;
  private activeTool: Tool = 'place';
  private hoveredGlyph: GodGlyph | null = null;
  private hoveredDial: Dial | null = null;
  private draggingDial: Dial | null = null;
  private dialDragStartY = 0;
  private dialDragStartAngle = 0;
  private tooltipText = '';
  private tooltipX = 0;
  private tooltipY = 0;

  private dials: Dial[] = [
    { label: '\u23f1', key: 'bpm' as keyof SimulationConfig, min: 40, max: 300, angle: 0.4, tooltip: 'Speed / BPM' },
    { label: '\u2623', key: 'mutationRate' as keyof SimulationConfig, min: 0, max: 1, angle: 0.3, tooltip: 'Mutation rate' },
    { label: '\u2618', key: 'resourceRegenRate' as keyof SimulationConfig, min: 0.1, max: 5, angle: 0.3, tooltip: 'Resource regen' },
  ];

  private gravityDial: Dial = {
    label: '\u2609', key: 'bpm' as keyof SimulationConfig, min: 0, max: 1, angle: 0, tooltip: 'Gravity strength',
  };

  getSelectedSpecies(): number { return this.selectedSpecies; }
  getActiveTool(): Tool { return this.activeTool; }

  applyTool(grid: GridState, cellX: number, cellY: number, config: SimulationConfig): void {
    switch (this.activeTool) {
      case 'place':
        spawnOrganism(grid, cellX, cellY, this.selectedSpecies);
        break;
      case 'flood':
        floodResources(grid, cellX, cellY, 3);
        break;
      case 'plague':
        plague(grid, cellX, cellY, 3);
        break;
      case 'mutate':
        mutateRegion(grid, cellX, cellY, 3);
        break;
      case 'earthquake':
        earthquake(grid);
        break;
    }
    void config;
  }

  handleMouseMove(mx: number, my: number, dishCx: number, dishCy: number, dishRadius: number): void {
    this.tooltipText = '';
    this.hoveredGlyph = null;
    this.hoveredDial = null;

    // Check god glyphs
    const glyphPositions = this.getGlyphPositions(dishCx, dishCy, dishRadius);
    for (let i = 0; i < glyphPositions.length; i++) {
      const p = glyphPositions[i];
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < 20 * 20) {
        this.hoveredGlyph = GOD_GLYPHS[i];
        this.tooltipText = GOD_GLYPHS[i].tooltip;
        this.tooltipX = mx;
        this.tooltipY = my - 25;
        return;
      }
    }

    // Check species wheel
    const wheelPositions = this.getWheelPositions(dishCx, dishCy, dishRadius);
    for (let i = 0; i < wheelPositions.length; i++) {
      const p = wheelPositions[i];
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < 18 * 18) {
        this.tooltipText = SPECIES_PRESETS[i].name;
        this.tooltipX = mx;
        this.tooltipY = my - 25;
        return;
      }
    }

    // Check dials
    const dialPositions = this.getDialPositions(dishCx, dishCy, dishRadius);
    for (let i = 0; i < dialPositions.length; i++) {
      const p = dialPositions[i];
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < 22 * 22) {
        this.hoveredDial = this.dials[i];
        this.tooltipText = this.dials[i].tooltip;
        this.tooltipX = mx;
        this.tooltipY = my - 25;
        return;
      }
    }

    // Gravity dial
    const gp = this.getGravityDialPosition(dishCx, dishCy, dishRadius);
    const gdx = mx - gp.x;
    const gdy = my - gp.y;
    if (gdx * gdx + gdy * gdy < 22 * 22) {
      this.hoveredDial = this.gravityDial;
      this.tooltipText = this.gravityDial.tooltip;
      this.tooltipX = mx;
      this.tooltipY = my - 25;
    }
  }

  handleClick(mx: number, my: number, dishCx: number, dishCy: number, dishRadius: number): boolean {
    // Check god glyphs
    const glyphPositions = this.getGlyphPositions(dishCx, dishCy, dishRadius);
    for (let i = 0; i < glyphPositions.length; i++) {
      const p = glyphPositions[i];
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < 20 * 20) {
        const tool = GOD_GLYPHS[i].tool;
        this.activeTool = this.activeTool === tool ? 'place' : tool;
        return true;
      }
    }

    // Check species wheel
    const wheelPositions = this.getWheelPositions(dishCx, dishCy, dishRadius);
    for (let i = 0; i < wheelPositions.length; i++) {
      const p = wheelPositions[i];
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < 18 * 18) {
        this.selectedSpecies = i;
        this.activeTool = 'place';
        return true;
      }
    }

    return false;
  }

  handleDialDragStart(mx: number, my: number, dishCx: number, dishCy: number, dishRadius: number): boolean {
    const dialPositions = this.getDialPositions(dishCx, dishCy, dishRadius);
    for (let i = 0; i < dialPositions.length; i++) {
      const p = dialPositions[i];
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < 22 * 22) {
        this.draggingDial = this.dials[i];
        this.dialDragStartY = my;
        this.dialDragStartAngle = this.dials[i].angle;
        return true;
      }
    }
    const gp = this.getGravityDialPosition(dishCx, dishCy, dishRadius);
    const gdx = mx - gp.x;
    const gdy = my - gp.y;
    if (gdx * gdx + gdy * gdy < 22 * 22) {
      this.draggingDial = this.gravityDial;
      this.dialDragStartY = my;
      this.dialDragStartAngle = this.gravityDial.angle;
      return true;
    }
    return false;
  }

  handleDialDrag(my: number, config: SimulationConfig): void {
    if (!this.draggingDial) return;
    const delta = (this.dialDragStartY - my) / 150;
    this.draggingDial.angle = Math.max(0, Math.min(1, this.dialDragStartAngle + delta));

    if (this.draggingDial === this.gravityDial) {
      if (this.draggingDial.angle < 0.05) {
        config.gravity = null;
      } else {
        const strength = this.draggingDial.angle;
        config.gravity = { x: 16 * strength, y: 16 * strength };
      }
    } else {
      const dial = this.draggingDial;
      const value = dial.min + (dial.max - dial.min) * dial.angle;
      (config as unknown as Record<string, number>)[dial.key as string] = value;
    }
  }

  handleDialDragEnd(): void {
    this.draggingDial = null;
  }

  isDraggingDial(): boolean {
    return this.draggingDial !== null;
  }

  syncFromConfig(config: SimulationConfig): void {
    for (const dial of this.dials) {
      const value = config[dial.key] as number;
      dial.angle = (value - dial.min) / (dial.max - dial.min);
    }
    this.gravityDial.angle = config.gravity ? Math.max(config.gravity.x, config.gravity.y) / 16 : 0;
  }

  render(ctx: CanvasRenderingContext2D, dishCx: number, dishCy: number, dishRadius: number): void {
    this.renderSpecimenWheel(ctx, dishCx, dishCy, dishRadius);
    this.renderGodGlyphs(ctx, dishCx, dishCy, dishRadius);
    this.renderDials(ctx, dishCx, dishCy, dishRadius);
    this.renderTooltip(ctx);
  }

  renderWalls(ctx: CanvasRenderingContext2D, grid: GridState, originX: number, originY: number, cellW: number, cellH: number, dishCx: number, dishCy: number, dishRadius: number): void {
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (!grid.cells[y][x].wall) continue;
        const px = originX + x * cellW + cellW / 2;
        const py = originY + y * cellH + cellH / 2;
        const dx = px - dishCx;
        const dy = py - dishCy;
        if (dx * dx + dy * dy > dishRadius * dishRadius) continue;

        ctx.fillStyle = 'rgba(120, 110, 100, 0.4)';
        ctx.fillRect(originX + x * cellW + 1, originY + y * cellH + 1, cellW - 2, cellH - 2);

        // Scratch marks
        ctx.strokeStyle = 'rgba(180, 170, 150, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(originX + x * cellW + 2, originY + y * cellH + 2);
        ctx.lineTo(originX + (x + 1) * cellW - 2, originY + (y + 1) * cellH - 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(originX + (x + 1) * cellW - 2, originY + y * cellH + 2);
        ctx.lineTo(originX + x * cellW + 2, originY + (y + 1) * cellH - 2);
        ctx.stroke();
      }
    }
  }

  private getGlyphPositions(cx: number, cy: number, r: number): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const startAngle = -Math.PI * 0.75;
    const spread = Math.PI * 0.3;
    for (let i = 0; i < GOD_GLYPHS.length; i++) {
      const angle = startAngle + (i / (GOD_GLYPHS.length - 1)) * spread;
      positions.push({
        x: cx + Math.cos(angle) * (r + 30),
        y: cy + Math.sin(angle) * (r + 30),
      });
    }
    return positions;
  }

  private getWheelPositions(cx: number, cy: number, r: number): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const startAngle = Math.PI * 0.55;
    const spread = Math.PI * 0.25;
    for (let i = 0; i < SPECIES_PRESETS.length; i++) {
      const angle = startAngle + (i / (SPECIES_PRESETS.length - 1)) * spread;
      positions.push({
        x: cx + Math.cos(angle) * (r + 30),
        y: cy + Math.sin(angle) * (r + 30),
      });
    }
    return positions;
  }

  private getDialPositions(cx: number, cy: number, r: number): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const startAngle = Math.PI * 0.05;
    const spread = Math.PI * 0.25;
    for (let i = 0; i < this.dials.length; i++) {
      const angle = startAngle + (i / (this.dials.length - 1)) * spread;
      positions.push({
        x: cx + Math.cos(angle) * (r + 30),
        y: cy + Math.sin(angle) * (r + 30),
      });
    }
    return positions;
  }

  private getGravityDialPosition(cx: number, cy: number, r: number): { x: number; y: number } {
    const angle = -Math.PI * 0.3;
    return {
      x: cx + Math.cos(angle) * (r + 30),
      y: cy + Math.sin(angle) * (r + 30),
    };
  }

  private renderSpecimenWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const positions = this.getWheelPositions(cx, cy, r);
    for (let i = 0; i < SPECIES_PRESETS.length; i++) {
      const p = positions[i];
      const preset = SPECIES_PRESETS[i];
      const isSelected = i === this.selectedSpecies && this.activeTool === 'place';
      const radius = isSelected ? 14 : 10;

      // Glow for selected
      if (isSelected) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2);
        glow.addColorStop(0, preset.color + '40');
        glow.addColorStop(1, preset.color + '00');
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Blob
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(p.x - 2, p.y - 2, 0, p.x, p.y, radius);
      grad.addColorStop(0, preset.color);
      grad.addColorStop(1, preset.color + '88');
      ctx.fillStyle = grad;
      ctx.fill();

      // Ring for selected
      if (isSelected) {
        ctx.strokeStyle = preset.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  private renderGodGlyphs(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const positions = this.getGlyphPositions(cx, cy, r);
    for (let i = 0; i < GOD_GLYPHS.length; i++) {
      const p = positions[i];
      const glyph = GOD_GLYPHS[i];
      const isActive = this.activeTool === glyph.tool;
      const isHovered = this.hoveredGlyph === glyph;

      // Glow
      if (isActive || isHovered) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 25);
        glow.addColorStop(0, glyph.color + (isActive ? '50' : '30'));
        glow.addColorStop(1, glyph.color + '00');
        ctx.beginPath();
        ctx.arc(p.x, p.y, 25, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Symbol
      ctx.font = '18px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isActive ? glyph.color : glyph.color + '88';
      ctx.fillText(glyph.symbol, p.x, p.y);
    }
  }

  private renderDials(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const allDials = [...this.dials, this.gravityDial];
    const dialPositions = [...this.getDialPositions(cx, cy, r), this.getGravityDialPosition(cx, cy, r)];

    for (let i = 0; i < allDials.length; i++) {
      const dial = allDials[i];
      const p = dialPositions[i];
      const knobRadius = 16;
      const isHovered = this.hoveredDial === dial;
      const isDragging = this.draggingDial === dial;

      // Knob background
      ctx.beginPath();
      ctx.arc(p.x, p.y, knobRadius, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? 'rgba(60, 70, 80, 0.8)' : isHovered ? 'rgba(50, 60, 70, 0.7)' : 'rgba(30, 35, 45, 0.6)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(100, 200, 140, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Value arc
      const startA = Math.PI * 0.75;
      const endA = startA + dial.angle * Math.PI * 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, knobRadius + 3, startA, endA);
      ctx.strokeStyle = 'rgba(100, 200, 140, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Indicator dot
      const dotAngle = endA;
      ctx.beginPath();
      ctx.arc(
        p.x + Math.cos(dotAngle) * (knobRadius - 4),
        p.y + Math.sin(dotAngle) * (knobRadius - 4),
        2.5, 0, Math.PI * 2,
      );
      ctx.fillStyle = 'rgba(100, 200, 140, 0.8)';
      ctx.fill();

      // Symbol
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(100, 200, 140, 0.5)';
      ctx.fillText(dial.label, p.x, p.y);
    }
  }

  private renderTooltip(ctx: CanvasRenderingContext2D): void {
    if (!this.tooltipText) return;

    ctx.font = '11px monospace';
    const metrics = ctx.measureText(this.tooltipText);
    const pad = 6;
    const w = metrics.width + pad * 2;
    const h = 18;

    ctx.fillStyle = 'rgba(10, 12, 20, 0.85)';
    ctx.fillRect(this.tooltipX - w / 2, this.tooltipY - h / 2, w, h);
    ctx.strokeStyle = 'rgba(100, 200, 140, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.tooltipX - w / 2, this.tooltipY - h / 2, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(100, 200, 140, 0.7)';
    ctx.fillText(this.tooltipText, this.tooltipX, this.tooltipY);
  }
}
