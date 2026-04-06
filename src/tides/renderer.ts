import * as THREE from 'three';
import type { TidesState } from './simulation.js';
import { SpectrumAnalyser } from '../ui/spectrum.js';

// ═══ WAVE VERTEX SHADER ═══
const waveVert = `
uniform float time;
uniform vec4 waveLayers[8];
uniform float wavePhases[8];
varying vec3 vWorldPos;
varying float vHeight;
varying vec3 vNormal2;

void main() {
  vec3 pos = position;
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 w = waveLayers[i];
    h += w.w * sin(pos.x * w.x + pos.z * w.y + time * w.z + wavePhases[i]);
  }
  pos.y = h;
  vHeight = h;
  vWorldPos = pos;

  float eps = 0.05;
  float hx = 0.0, hz = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 w = waveLayers[i];
    hx += w.w * sin((pos.x + eps) * w.x + pos.z * w.y + time * w.z + wavePhases[i]);
    hz += w.w * sin(pos.x * w.x + (pos.z + eps) * w.y + time * w.z + wavePhases[i]);
  }
  vNormal2 = normalize(cross(vec3(0.0, hz - h, eps), vec3(eps, hx - h, 0.0)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

// ═══ WAVE FRAGMENT SHADER ═══
const waveFrag = `
varying vec3 vWorldPos;
varying float vHeight;
varying vec3 vNormal2;

void main() {
  float h = vHeight * 1.5 + 0.5;

  vec3 deepWater = vec3(0.03, 0.08, 0.18);
  vec3 midWater  = vec3(0.08, 0.25, 0.42);
  vec3 shallowWater = vec3(0.16, 0.45, 0.62);

  vec3 waterCol = mix(deepWater, midWater, smoothstep(0.2, 0.5, h));
  waterCol = mix(waterCol, shallowWater, smoothstep(0.5, 0.75, h));

  vec3 lightDir = normalize(vec3(0.2, 0.8, 0.3));
  float diffuse = max(dot(vNormal2, lightDir), 0.0);

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(vNormal2, viewDir), 0.0), 3.0);

  vec3 skyReflect = vec3(0.06, 0.15, 0.22) + vec3(0.05, 0.15, 0.1) * fresnel;
  vec3 col = mix(waterCol, skyReflect, fresnel * 0.5);
  col *= 0.5 + diffuse * 0.5;

  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(vNormal2, halfDir), 0.0), 80.0);
  col += vec3(0.6, 0.8, 0.9) * spec * 0.3;

  // Moonlight specular
  vec3 moonDir = normalize(vec3(-0.5, 0.6, -0.3));
  vec3 moonHalf = normalize(moonDir + viewDir);
  float moonSpec = pow(max(dot(vNormal2, moonHalf), 0.0), 40.0);
  col += vec3(0.3, 0.4, 0.5) * moonSpec * 0.2;

  float foam = smoothstep(0.78, 0.95, h);
  col = mix(col, vec3(0.5, 0.65, 0.75), foam * 0.25);

  gl_FragColor = vec4(col, 1.0);
}`;

// ═══ AURORA SHADER ═══
const auroraVert = `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const auroraFrag = `
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Sky gradient: dark top → slightly lighter horizon
  vec3 skyTop = vec3(0.02, 0.03, 0.08);
  vec3 skyMid = vec3(0.04, 0.06, 0.14);
  vec3 skyHorizon = vec3(0.08, 0.12, 0.22);
  float yNorm = vUv.y;
  vec3 sky = mix(skyHorizon, mix(skyMid, skyTop, smoothstep(0.3, 0.9, yNorm)), yNorm);

  // Aurora curtains — 3 overlapping bands
  float aurora = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float xFreq = 2.0 + fi * 0.8;
    float xOff = fi * 1.5;
    float n = fbm(vec2(vUv.x * xFreq + xOff, uTime * 0.06 + fi * 0.5));
    float wave = sin(vUv.x * 6.0 + fi * 2.1 + n * 3.0 + uTime * 0.1);
    float band = smoothstep(0.0, 0.35, 1.0 - abs(wave)) * (0.5 + fi * 0.2);
    // Vertical mask: aurora lives in upper-middle sky
    float vertMask = smoothstep(0.25, 0.5, yNorm) * smoothstep(0.95, 0.7, yNorm);
    // Shimmer
    float shimmer = fbm(vec2(vUv.x * 15.0 + fi * 3.0, yNorm * 8.0 - uTime * 0.15 + fi)) * 0.6 + 0.4;
    aurora += band * vertMask * shimmer * 0.4;
  }

  // Aurora color: green at base, teal-purple at top
  vec3 auroraGreen = vec3(0.15, 0.75, 0.45);
  vec3 auroraTeal = vec3(0.1, 0.5, 0.55);
  vec3 auroraPurple = vec3(0.3, 0.12, 0.45);
  vec3 auroraCol = mix(auroraGreen, auroraTeal, smoothstep(0.4, 0.6, yNorm));
  auroraCol = mix(auroraCol, auroraPurple, smoothstep(0.65, 0.85, yNorm));

  vec3 col = sky + auroraCol * aurora;

  gl_FragColor = vec4(col, 1.0);
}`;

// ═══ RENDERER ═══
export class TidesRenderer {
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private waveMaterial!: THREE.ShaderMaterial;
  private auroraMaterial!: THREE.ShaderMaterial;
  private cameraAngle = 0;

  private spectrum!: SpectrumAnalyser;

  constructor(container: HTMLElement) {
    this.container = container;
    this.init();
  }

  private init(): void {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // Camera: above the water, looking toward horizon
    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 500);
    this.camera.position.set(0, 1.2, 4);
    this.camera.lookAt(0, 0, -2);
    this.cameraAngle = 0;

    // ── Aurora sky dome ──
    const skyGeo = new THREE.SphereGeometry(200, 32, 32);
    this.auroraMaterial = new THREE.ShaderMaterial({
      vertexShader: auroraVert,
      fragmentShader: auroraFrag,
      uniforms: { uTime: { value: 0 } },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(skyGeo, this.auroraMaterial));

    // ── Moon ──
    const moonGeo = new THREE.SphereGeometry(3, 16, 16);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xeeeedd });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.set(-40, 60, -100);
    this.scene.add(moon);

    // Moon glow
    const glowGeo = new THREE.SphereGeometry(5, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xccccbb, transparent: true, opacity: 0.08 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(moon.position);
    this.scene.add(glow);

    // ── Ocean mesh ──
    const planeGeo = new THREE.PlaneGeometry(100, 100, 200, 200);
    planeGeo.rotateX(-Math.PI / 2);

    this.waveMaterial = new THREE.ShaderMaterial({
      vertexShader: waveVert,
      fragmentShader: waveFrag,
      uniforms: {
        time: { value: 0 },
        waveLayers: { value: new Array(8).fill(new THREE.Vector4(0, 0, 0, 0)) },
        wavePhases: { value: new Array(8).fill(0) },
      },
      side: THREE.DoubleSide,
    });

    this.scene.add(new THREE.Mesh(planeGeo, this.waveMaterial));

    // Subtle ambient light
    this.scene.add(new THREE.AmbientLight(0x1a2a3a, 0.3));

    // Spectrum analyser overlay
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

  render(state: TidesState): void {
    // Update wave uniforms
    const layers = state.layers;
    const layerVecs: THREE.Vector4[] = [];
    const phases: number[] = [];
    for (let i = 0; i < 8; i++) {
      if (i < layers.length) {
        layerVecs.push(new THREE.Vector4(layers[i].freqX, layers[i].freqZ, layers[i].speed, layers[i].amplitude));
        phases.push(layers[i].phase);
      } else {
        layerVecs.push(new THREE.Vector4(0, 0, 0, 0));
        phases.push(0);
      }
    }
    this.waveMaterial.uniforms.time.value = state.time;
    this.waveMaterial.uniforms.waveLayers.value = layerVecs;
    this.waveMaterial.uniforms.wavePhases.value = phases;

    // Update aurora time
    this.auroraMaterial.uniforms.uTime.value = state.time;

    // Slow camera orbit — stays at fixed height, always looking at water
    this.cameraAngle += 0.0008;
    const camDist = 5;
    const camHeight = 1.3;
    this.camera.position.set(
      Math.sin(this.cameraAngle) * camDist,
      camHeight,
      Math.cos(this.cameraAngle) * camDist,
    );
    this.camera.lookAt(0, -0.2, 0);

    this.renderer.render(this.scene, this.camera);

    this.spectrum.draw();
  }

  dispose(): void {
    this.waveMaterial.dispose();
    this.auroraMaterial.dispose();
    this.renderer.dispose();
  }
}
