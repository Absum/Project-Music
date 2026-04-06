export interface TidesParams {
  feed: number;
  kill: number;
  dA: number;
  dB: number;
  speed: number;
}

const SIM_SIZE = 128; // smaller for CPU, still looks good

export class TidesSimulation {
  private gridA: Float32Array;
  private gridB: Float32Array;
  private nextA: Float32Array;
  private nextB: Float32Array;
  private imageData: ImageData;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  params: TidesParams = {
    feed: 0.055,
    kill: 0.062,
    dA: 0.2097,
    dB: 0.105,
    speed: 8,
  };

  readonly size = SIM_SIZE;
  private time = 0;

  constructor() {
    const n = SIM_SIZE * SIM_SIZE;
    this.gridA = new Float32Array(n).fill(1);
    this.gridB = new Float32Array(n).fill(0);
    this.nextA = new Float32Array(n);
    this.nextB = new Float32Array(n);

    this.canvas = new OffscreenCanvas(SIM_SIZE, SIM_SIZE);
    this.ctx = this.canvas.getContext('2d')!;
    this.imageData = this.ctx.createImageData(SIM_SIZE, SIM_SIZE);

    this.seed();
  }

  private seed(): void {
    // Add circular B seeds
    for (let s = 0; s < 8; s++) {
      const cx = 15 + Math.floor(Math.random() * (SIM_SIZE - 30));
      const cy = 15 + Math.floor(Math.random() * (SIM_SIZE - 30));
      const r = 3 + Math.floor(Math.random() * 5);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            const x = cx + dx, y = cy + dy;
            if (x >= 0 && x < SIM_SIZE && y >= 0 && y < SIM_SIZE) {
              this.gridB[y * SIM_SIZE + x] = 1.0;
            }
          }
        }
      }
    }
  }

  step(): void {
    this.time += 0.001;

    // Gentle drift within the stable pattern-forming region of Gray-Scott space
    const d1 = Math.sin(this.time * 1.0) * 0.5 + 0.5;
    const d2 = Math.sin(this.time * 0.61) * 0.5 + 0.5;
    const feed = 0.04 + d1 * 0.018;    // 0.040-0.058
    const kill = 0.060 + d2 * 0.005;   // 0.060-0.065
    this.params.feed = feed;
    this.params.kill = kill;

    const { dA, dB } = this.params;
    const w = SIM_SIZE;

    for (let s = 0; s < this.params.speed; s++) {
      const A = this.gridA, B = this.gridB;
      const nA = this.nextA, nB = this.nextB;

      for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;

          const left  = y * w + ((x - 1 + w) % w);
          const right = y * w + ((x + 1) % w);
          const up    = ((y - 1 + w) % w) * w + x;
          const down  = ((y + 1) % w) * w + x;

          const a = A[i], b = B[i];
          const lapA = A[left] + A[right] + A[up] + A[down] - 4 * a;
          const lapB = B[left] + B[right] + B[up] + B[down] - 4 * b;

          const abb = a * b * b;
          nA[i] = Math.max(0, Math.min(1, a + (dA * lapA - abb + feed * (1 - a))));
          nB[i] = Math.max(0, Math.min(1, b + (dB * lapB + abb - (kill + feed) * b)));
        }
      }

      // Swap: next becomes current
      const tmpA = this.gridA;
      const tmpB = this.gridB;
      this.gridA = this.nextA;
      this.gridB = this.nextB;
      this.nextA = tmpA;
      this.nextB = tmpB;
    }
  }

  getImageBitmap(): ImageBitmap | OffscreenCanvas {
    const data = this.imageData.data;
    for (let i = 0; i < SIM_SIZE * SIM_SIZE; i++) {
      const b = this.gridB[i];
      const a = this.gridA[i];

      // Bioluminescent palette
      const t = b * 2.5;
      const r = Math.floor(Math.max(0, Math.min(255, (0.04 + 0.15 * Math.cos(6.28 * (0.25 * t + 0.75))) * (0.3 + b * 2.5) * 255 * (0.4 + a * 0.6))));
      const g = Math.floor(Math.max(0, Math.min(255, (0.06 + 0.55 * Math.cos(6.28 * (0.6 * t + 0.35))) * (0.3 + b * 2.5) * 255 * (0.4 + a * 0.6))));
      const bl = Math.floor(Math.max(0, Math.min(255, (0.12 + 0.65 * Math.cos(6.28 * (0.5 * t + 0.15))) * (0.3 + b * 2.5) * 255 * (0.4 + a * 0.6))));

      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = bl;
      data[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(this.imageData, 0, 0);
    return this.canvas;
  }

  readConcentrations(): { a: number[][]; b: number[][] } {
    const step = SIM_SIZE / 32;
    const a: number[][] = [];
    const b: number[][] = [];
    for (let y = 0; y < 32; y++) {
      const rowA: number[] = [];
      const rowB: number[] = [];
      for (let x = 0; x < 32; x++) {
        const sx = Math.floor(x * step);
        const sy = Math.floor(y * step);
        rowA.push(this.gridA[sy * SIM_SIZE + sx]);
        rowB.push(this.gridB[sy * SIM_SIZE + sx]);
      }
      a.push(rowA);
      b.push(rowB);
    }
    return { a, b };
  }

  dispose(): void {
    // nothing to dispose for CPU version
  }
}
