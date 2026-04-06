import { TidesSimulation } from './simulation.js';

export class TidesRenderer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  simulation: TidesSimulation;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.objectFit = 'cover';
    this.canvas.style.imageRendering = 'auto';
    container.innerHTML = '';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;
    this.simulation = new TidesSimulation();
    this.onResize();

    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    // Canvas size matches simulation — CSS scales it up smoothly
    this.canvas.width = this.simulation.size;
    this.canvas.height = this.simulation.size;
  }

  private resizeTimer = 0;
  resize(): void {
    const now = performance.now();
    if (now - this.resizeTimer < 1000) return;
    this.resizeTimer = now;
    this.onResize();
  }

  render(): void {
    this.simulation.step();
    const img = this.simulation.getImageBitmap();
    this.ctx.drawImage(img as OffscreenCanvas, 0, 0);
  }

  dispose(): void {
    this.simulation.dispose();
  }
}
