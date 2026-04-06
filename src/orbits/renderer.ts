import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { OrbitsState, Body } from './simulation.js';
import { getResonance } from './simulation.js';
import { SpectrumAnalyser } from '../ui/spectrum.js';

const MAX_TRAIL = 800;
const RESONANCE_POINTS = 21;
const MAX_RESONANCE_LINES = 10;

export class OrbitsRenderer {
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  // Pre-allocated body visuals
  private bodyMeshes: Map<number, THREE.Mesh> = new Map();
  private glowMeshes: Map<number, THREE.Mesh> = new Map();
  private trailLines: Map<number, THREE.Line> = new Map();
  private bodyColors: Map<number, THREE.Color> = new Map();

  // Pre-allocated resonance line pool
  private resonanceLines: THREE.Line[] = [];

  // Center
  private centerLight!: THREE.PointLight;
  private centerGlow!: THREE.Mesh;
  private lastEnergy = -1;

  private time = 0;
  private spectrum!: SpectrumAnalyser;

  constructor(container: HTMLElement) {
    this.container = container;
    this.init();
  }

  private init(): void {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x08080e);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 1, 2000);
    this.camera.position.set(500, 350, 500);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.minDistance = 200;
    this.controls.maxDistance = 1500;

    this.renderer.domElement.addEventListener('pointerdown', () => { this.controls.autoRotate = false; });
    this.renderer.domElement.addEventListener('pointerup', () => { setTimeout(() => { this.controls.autoRotate = true; }, 3000); });

    // Minimal lighting
    this.scene.add(new THREE.AmbientLight(0x222244, 1));
    this.centerLight = new THREE.PointLight(0x419EC7, 2, 800);
    this.scene.add(this.centerLight);

    // Center dot
    const centerGeo = new THREE.SphereGeometry(5, 8, 6);
    const centerMat = new THREE.MeshBasicMaterial({ color: 0x419EC7, transparent: true, opacity: 0.6 });
    this.centerGlow = new THREE.Mesh(centerGeo, centerMat);
    this.scene.add(this.centerGlow);

    // Star field — small round dots
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(1000 * 3);
    for (let i = 0; i < 1000; i++) {
      starPositions[i * 3] = (Math.random() - 0.5) * 1500;
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 1500;
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 1500;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x334466, size: 1.5, sizeAttenuation: true });
    this.scene.add(new THREE.Points(starGeo, starMat));

    // Pre-allocate resonance line pool
    for (let i = 0; i < MAX_RESONANCE_LINES; i++) {
      const positions = new Float32Array(RESONANCE_POINTS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x419EC7, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      this.scene.add(line);
      this.resonanceLines.push(line);
    }

    this.spectrum = new SpectrumAnalyser(this.container);

    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private resizeTimer = 0;
  resize(): void {
    const now = performance.now();
    if (now - this.resizeTimer < 1000) return;
    this.resizeTimer = now;
    this.onResize();
  }

  render(state: OrbitsState, _chord: string): void {
    this.time += 0.016;

    // Center glow — only update if energy changed
    const energy = state.energy;
    if (Math.abs(energy - this.lastEnergy) > 0.01) {
      this.centerLight.intensity = 1 + energy * 3;
      this.centerGlow.scale.setScalar(1 + energy * 2);
      (this.centerGlow.material as THREE.MeshBasicMaterial).opacity = 0.3 + energy * 0.3;
      this.lastEnergy = energy;
    }

    // Update bodies (skip center)
    for (const body of state.bodies) {
      if (body.fixed) continue;
      this.updateBody(body);
    }

    // Update resonance lines
    this.updateResonances(state);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.spectrum.draw();
  }

  private getColor(body: Body): THREE.Color {
    let c = this.bodyColors.get(body.id);
    if (!c) { c = new THREE.Color(body.color); this.bodyColors.set(body.id, c); }
    return c;
  }

  private updateBody(body: Body): void {
    const color = this.getColor(body);

    // Body mesh — create once
    let mesh = this.bodyMeshes.get(body.id);
    if (!mesh) {
      const radius = body.role === 'center' ? 5 : 4 + body.mass * 2;
      const geo = new THREE.SphereGeometry(radius, 8, 6);
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.5,
        metalness: 0.2, roughness: 0.3,
      });
      mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh);
      this.bodyMeshes.set(body.id, mesh);

      // Glow
      const glowGeo = new THREE.SphereGeometry(radius * 2.5, 8, 6);
      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06 });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      this.scene.add(glow);
      this.glowMeshes.set(body.id, glow);

      // Trail — pre-allocate buffer
      const trailPositions = new Float32Array(MAX_TRAIL * 3);
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
      trailGeo.setDrawRange(0, 0);
      const trailMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.15 });
      const trail = new THREE.Line(trailGeo, trailMat);
      this.scene.add(trail);
      this.trailLines.set(body.id, trail);
    }

    mesh.position.set(body.x, body.y, body.z);
    const pulse = 1 + Math.sin(body.phase * 6.283) * 0.15;
    mesh.scale.setScalar(pulse);

    const glow = this.glowMeshes.get(body.id);
    if (glow) {
      glow.position.set(body.x, body.y, body.z);
      glow.scale.setScalar(pulse);
    }

    // Trail — update pre-allocated buffer
    const trail = this.trailLines.get(body.id);
    if (trail && body.trail.length > 1) {
      const attr = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const len = Math.min(body.trail.length, MAX_TRAIL);
      for (let i = 0; i < len; i++) {
        arr[i * 3] = body.trail[i].x;
        arr[i * 3 + 1] = body.trail[i].y;
        arr[i * 3 + 2] = body.trail[i].z;
      }
      attr.needsUpdate = true;
      trail.geometry.setDrawRange(0, len);
    }
  }

  private updateResonances(state: OrbitsState): void {
    let lineIdx = 0;

    for (let i = 1; i < state.bodies.length && lineIdx < MAX_RESONANCE_LINES; i++) {
      for (let j = i + 1; j < state.bodies.length && lineIdx < MAX_RESONANCE_LINES; j++) {
        const a = state.bodies[i];
        const b = state.bodies[j];
        const res = getResonance(a, b);
        const line = this.resonanceLines[lineIdx];

        if (res > 0.3) {
          const alpha = (res - 0.3) * 0.5;
          const pulse = 0.5 + Math.sin(this.time * 3 + i + j) * 0.5;

          // Inline quadratic Bezier — no object allocation
          const mx = (a.x + b.x) * 0.5 + Math.sin(this.time * 2 + i) * 0.5;
          const my = (a.y + b.y) * 0.5 + Math.cos(this.time * 2 + j) * 0.5;
          const mz = (a.z + b.z) * 0.5 + Math.sin(this.time * 1.5) * 0.5;

          const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
          const arr = attr.array as Float32Array;
          for (let p = 0; p < RESONANCE_POINTS; p++) {
            const t = p / (RESONANCE_POINTS - 1);
            const t1 = 1 - t;
            arr[p * 3]     = t1 * t1 * a.x + 2 * t1 * t * mx + t * t * b.x;
            arr[p * 3 + 1] = t1 * t1 * a.y + 2 * t1 * t * my + t * t * b.y;
            arr[p * 3 + 2] = t1 * t1 * a.z + 2 * t1 * t * mz + t * t * b.z;
          }
          attr.needsUpdate = true;
          (line.material as THREE.LineBasicMaterial).opacity = alpha * pulse;
          line.visible = true;
        } else {
          line.visible = false;
        }
        lineIdx++;
      }
    }

    for (; lineIdx < MAX_RESONANCE_LINES; lineIdx++) {
      this.resonanceLines[lineIdx].visible = false;
    }
  }
}
