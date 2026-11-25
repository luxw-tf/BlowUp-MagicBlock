/**
 * Map 01: The Docks. A sunny, chunky harbour in the spirit of cosy party games: a concrete deck with painted
 * bay markings, a quay over animated water, container stacks, a working crane, boats and gulls.
 * The playable area and every obstacle come from the authoritative arena definition (game/arena.ts) and keep
 * their exact footprints; only their look lives here. Everything that moves is decoration.
 */
import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef, type ReactNode } from 'react';
import { MODEL, Prop } from './models';
import * as THREE from 'three';
import { ARENA, OBSTACLES, currentMood, type Mood } from '../game/arena';

// ───────────────────────────── palette ─────────────────────────────

const P = {
  deck: '#c9cfd3',
  deckDark: '#c3bcae',
  quay: '#a3aab0',
  line: '#f5c431',
  ink: '#2b2a33',
  orange: '#ec6a3c',
  blue: '#3f7fd1',
  teal: '#2fa89b',
  yellow: '#f4b93a',
  red: '#d94a43',
  cream: '#f6efe1',
  wood: '#c99257',
  woodDark: '#9c6a39',
  leaf: '#5fb352',
  leafDark: '#3f8f3c',
  steel: '#59616b',
};

// ───────────────────────────── textures ─────────────────────────────

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** The playable deck: warm concrete slabs, cracks, stains, painted bay markings. 32 px per world unit. */
function makeDeckTexture(): THREE.CanvasTexture {
  const U = 32, W = ARENA.halfWidth * 2, D = ARENA.halfDepth * 2;
  const c = document.createElement('canvas');
  c.width = W * U; c.height = D * U;
  const g = c.getContext('2d')!;
  const r = rng(7);
  g.fillStyle = P.deck; g.fillRect(0, 0, c.width, c.height);
  // slabs, each a hair different, with soft bevelled seams
  const s = 4 * U;
  for (let y = 0; y < c.height; y += s / 2) {
    for (let x = (y / (s / 2)) % 2 ? -s / 2 : 0; x < c.width; x += s) {
      const v = Math.floor(r() * 14) - 7;
      g.fillStyle = `rgb(${198 + v},${204 + v},${209 + v})`;
      g.fillRect(x + 2, y + 2, s - 4, s / 2 - 4);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 2, y + 2, s - 4, 3);
      g.fillStyle = 'rgba(60,50,40,0.10)'; g.fillRect(x + 2, y + s / 2 - 6, s - 4, 4);
    }
  }
  // speckle + a few oil stains and hairline cracks
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(70,60,50,${r() * 0.07})`; g.fillRect(r() * c.width, r() * c.height, 2, 2); }
  for (let i = 0; i < 9; i++) {
    const gx = r() * c.width, gy = r() * c.height, gr = 20 + r() * 50;
    const grd = g.createRadialGradient(gx, gy, 0, gx, gy, gr);
    grd.addColorStop(0, 'rgba(70,60,55,0.16)'); grd.addColorStop(1, 'rgba(70,60,55,0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(gx, gy, gr, gr * 0.7, r() * 3, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(80,70,60,0.35)'; g.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    let x = r() * c.width, y = r() * c.height; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.3) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  // painted markings: a bay outline, corner brackets, a dashed lane and stencilled bay number
  g.strokeStyle = P.line; g.lineWidth = 7; g.globalAlpha = 0.9;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.setLineDash([26, 20]); g.lineWidth = 5;
  g.beginPath(); g.moveTo(40, c.height / 2); g.lineTo(c.width * 0.32, c.height / 2); g.moveTo(c.width * 0.68, c.height / 2); g.lineTo(c.width - 40, c.height / 2); g.stroke();
  g.setLineDash([]);
  const hazard = (x: number, y: number, w: number, h: number) => {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = P.line; g.fillRect(x, y, w, h); g.fillStyle = P.ink;
    for (let k = -h; k < w + h; k += 22) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + 11, y); g.lineTo(x + k + 11 - h, y + h); g.lineTo(x + k - h, y + h); g.fill(); }
    g.restore();
  };
  hazard(34, 34, 120, 22); hazard(c.width - 154, c.height - 56, 120, 22);
  hazard(c.width - 154, 34, 120, 22); hazard(34, c.height - 56, 120, 22);
  g.globalAlpha = 0.55; g.fillStyle = P.cream;
  g.font = `900 ${U * 2.2}px Arial Black, Impact, sans-serif`; g.textAlign = 'center';
  g.fillText('BAY 7', c.width * 0.5, c.height * 0.2);
  g.save(); g.translate(c.width * 0.5, c.height * 0.86); g.rotate(Math.PI); g.fillText('BAY 7', 0, 0); g.restore();
  g.globalAlpha = 1;
  // drain grates by the bay number
  for (const [x, y] of [[c.width * 0.3, c.height * 0.2], [c.width * 0.7, c.height * 0.8]]) {
    g.fillStyle = '#7c776e'; g.fillRect(x - 22, y - 14, 44, 28);
    g.fillStyle = '#4c4843'; for (let k = 0; k < 6; k++) g.fillRect(x - 18 + k * 7, y - 10, 4, 20);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

/** The surrounding quay: bigger, rougher slabs. Tiles. */
function makeQuayTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!; const r = rng(11);
  g.fillStyle = P.quay; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '70,64,56' : '235,230,220'},${r() * 0.1})`; g.fillRect(r() * 256, r() * 256, 3, 3); }
  g.strokeStyle = 'rgba(70,64,56,0.4)'; g.lineWidth = 3; g.strokeRect(1, 1, 254, 254); g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(16, 7); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

/** Black and yellow hazard stripes for the quay lip. */
function makeHazardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = P.line; g.fillRect(0, 0, 128, 32); g.fillStyle = P.ink;
  for (let k = -32; k < 160; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 16, 0); g.lineTo(k - 16, 32); g.lineTo(k - 32, 32); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 1); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wooden crate face: planks, a frame and a cross brace. */
function makeCrateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!; const r = rng(3);
  for (let y = 0; y < 128; y += 21) {
    const v = Math.floor(r() * 20) - 10;
    g.fillStyle = `rgb(${201 + v},${146 + v},${87 + v})`; g.fillRect(0, y, 128, 20);
    g.fillStyle = 'rgba(90,55,25,0.35)'; g.fillRect(0, y + 19, 128, 2);
    for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(120,75,35,0.25)'; g.fillRect(r() * 128, y + 4 + r() * 12, 18, 1.5); }
  }
  g.strokeStyle = P.woodDark; g.lineWidth = 12; g.strokeRect(6, 6, 116, 116);
  g.lineWidth = 11; g.beginPath(); g.moveTo(10, 118); g.lineTo(118, 10); g.stroke();
  g.fillStyle = '#5b4a3a'; for (const [x, y] of [[12, 12], [116, 12], [12, 116], [116, 116]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ───────────────────────────── water ─────────────────────────────

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    // gentle rolling swells in two directions (kept small so the water still reads as flat from above)
    w.y += sin(w.x * 0.32 + uTime * 1.0) * 0.07 + cos(w.z * 0.4 + uTime * 0.8) * 0.06 + sin((w.x + w.z) * 0.9 + uTime * 1.7) * 0.02;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform float uEdgeZ;      // the quay line (foam hugs it)
  uniform vec2 uCentre;      // basin mode: centre and radius of the rim
  uniform float uRadius;
  uniform float uBasin;
  uniform vec3 uRings[10];   // things floating in the sea: x, z, radius (foam rings round them)
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uTint;
  varying vec3 vWorld;

  vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  // cellular noise: distance to the nearest and second-nearest drifting point (F1, F2)
  vec2 cells(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash2(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return vec2(d1, d2);
  }

  void main() {
    vec2 p = vWorld.xz;
    float basin = uBasin;
    float edge = basin > 0.5 ? uRadius - length(p - uCentre) : uEdgeZ - p.y;   // distance from the wall
    float depth = clamp(edge / (basin > 0.5 ? 2.2 : 18.0), 0.0, 1.0);
    // a three-step ramp: bright turquoise by the wall, clear blue, deep blue out at sea
    vec3 col = depth < 0.35 ? mix(uShallow, uMid, depth / 0.35) : mix(uMid, uDeep, (depth - 0.35) / 0.65);

    // painted foam: the edges of drifting cells, broken up so it comes in patches (the classic toon-water look)
    float scale = basin > 0.5 ? 1.4 : 0.55;
    vec2 c = cells(p * scale + vec2(uTime * 0.05, uTime * 0.03), uTime * 0.6);
    float web = smoothstep(0.05, 0.012, c.y - c.x);
    float patchy = smoothstep(0.5, 0.78, noise(p * 0.09 + vec2(uTime * 0.025, -uTime * 0.018)));
    float foamAmt = basin > 0.5 ? 0.0 : web * patchy * mix(0.95, 0.35, depth);   // the basin is too small for foam patches
    // in the basin: soft bands of light rippling out from the fountain instead
    if (basin > 0.5) col += smoothstep(0.55, 1.0, sin(length(p - uCentre) * 5.5 - uTime * 2.2)) * 0.05;
    // subtle darker cell centres give the surface a hammered, moving feel
    if (basin < 0.5) col *= 1.0 - smoothstep(0.0, 0.6, c.x) * 0.06;

    // foam hugging the wall, with a second line that swells in and out
    float lap = sin(uTime * 1.4 + (basin > 0.5 ? atan(p.y - uCentre.y, p.x - uCentre.x) * 6.0 : p.x * 0.45)) * 0.22;
    foamAmt += smoothstep(0.55, 0.05, edge);
    foamAmt += basin > 0.5 ? 0.0 : smoothstep(0.07, 0.0, abs(edge - 0.95 - lap)) * 0.7;

    // foam rings round everything floating: a hugging ring plus slow ripples spreading out
    if (basin < 0.5) {
      for (int k = 0; k < 10; k++) {
        vec3 r = uRings[k];
        if (r.z <= 0.0) continue;
        float d = length(p - r.xy) - r.z;
        foamAmt += smoothstep(0.35, 0.0, abs(d - 0.15)) * 0.9;
        float t = fract(uTime * 0.3 + float(k) * 0.37);
        foamAmt += smoothstep(0.12, 0.0, abs(d - t * 2.4)) * (1.0 - t) * 0.7;
      }
    }

    col = mix(col, uFoam, clamp(foamAmt, 0.0, 1.0));

    // sun glints: tiny diamonds that wink on and off
    vec2 cell = floor(p * 2.4 + vec2(uTime * 0.25, 0.0));
    float sp = step(0.988, hash(cell)) * smoothstep(0.5, 1.0, sin(uTime * 3.2 + hash(cell + 3.1) * 6.28));
    col += sp * 0.6 * (1.0 - depth * 0.4);

    col *= uTint;   // the time of day
    // match the scene fog so the far water melts into the sky
    float d = length(cameraPosition - vWorld);
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, d));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Where things float in the sea (x, z, foam radius), so the water draws foam round them. */
export const SEA_RINGS: [number, number, number][] = [
  [15, -20.5, 2.6], [-22, -24, 2.4], [-4, -30, 1.9], [32, -40, 7], [3, -17.5, 0.55], [-13, -19, 0.5], [24, -17, 0.5],
  [10.5, -16.6, 0.35], [14.5, -16.6, 0.35], [12.5, -18.6, 0.35],
];

export const FOG = { color: '#bfe6f5', near: 70, far: 170 };

/** Light for each time of day. Sun position is where the light comes from; water tint multiplies the sea. */
export interface Light {
  sky: string; fogNear: number; fogFar: number;
  sun: string; sunI: number; sunPos: [number, number, number];
  hemiSky: string; hemiGround: string; hemiI: number;
  water: [number, number, number]; lamps: boolean; exposure: number;
}
export const LIGHT: Record<Mood, Light> = {
  morning: { sky: '#cfe8f4', fogNear: 60, fogFar: 160, sun: '#ffe1b5', sunI: 2.0, sunPos: [30, 20, 14], hemiSky: '#dcefff', hemiGround: '#74706a', hemiI: 0.85, water: [1, 1, 1], lamps: false, exposure: 1.05 },
  noon: { sky: '#bfe6f5', fogNear: 70, fogFar: 170, sun: '#fff0d2', sunI: 2.3, sunPos: [-20, 30, 6], hemiSky: '#cfeaff', hemiGround: '#6a7684', hemiI: 0.8, water: [1, 1, 1], lamps: false, exposure: 1.08 },
  sunset: { sky: '#f4c09a', fogNear: 55, fogFar: 150, sun: '#ffa463', sunI: 2.4, sunPos: [-36, 11, -12], hemiSky: '#ffd0ad', hemiGround: '#574657', hemiI: 0.7, water: [1.05, 0.82, 0.78], lamps: true, exposure: 1.02 },
  night: { sky: '#0e1a33', fogNear: 40, fogFar: 120, sun: '#9db8ff', sunI: 0.45, sunPos: [14, 30, 10], hemiSky: '#2c4170', hemiGround: '#0e0e16', hemiI: 0.38, water: [0.24, 0.33, 0.52], lamps: true, exposure: 1.0 },
};
export const lightNow = () => LIGHT[currentMood()];

function useWaterMaterial(basin: { x: number; z: number; r: number } | null) {
  return useMemo(() => {
    const rings = Array.from({ length: 10 }, (_, i) => {
      const r = basin ? undefined : SEA_RINGS[i];
      return new THREE.Vector3(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0);
    });
    return new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(basin ? '#1f9ccc' : '#0f6fb0') },
        uMid: { value: new THREE.Color(basin ? '#3cc3e2' : '#1ea7d6') },
        uShallow: { value: new THREE.Color(basin ? '#8ff0f0' : '#5fe2e6') },
        uFoam: { value: new THREE.Color('#f5feff') },
        uEdgeZ: { value: -13.3 },
        uCentre: { value: new THREE.Vector2(basin?.x ?? 0, basin?.z ?? 0) },
        uRadius: { value: basin?.r ?? 0 },
        uBasin: { value: basin ? 1 : 0 },
        uRings: { value: rings },
        uFogColor: { value: new THREE.Color(lightNow().sky) },
        uFogNear: { value: lightNow().fogNear },
        uFogFar: { value: lightNow().fogFar },
        uTint: { value: new THREE.Vector3(...lightNow().water) },
      },
    });
  }, [basin]);
}

function Sea() {
  const mat = useWaterMaterial(null);
  useFrame(({ clock }) => (mat.uniforms.uTime.value = clock.elapsedTime));
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, -62]} material={mat}>
      <planeGeometry args={[260, 98, 130, 50]} />
    </mesh>
  );
}

// ───────────────────────────── props ─────────────────────────────

function Container({ position, rotation = 0, color, len = 6 }: { position: [number, number, number]; rotation?: number; color: string; len?: number }) {
  const ribs = useMemo(() => Array.from({ length: Math.round(len / 0.45) }, (_, i) => -len / 2 + 0.22 + i * 0.45), [len]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 1.3, 0]}>
        <boxGeometry args={[len, 2.6, 2.4]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
      </mesh>
      {ribs.map((x) => (
        <group key={x}>
          <mesh position={[x, 1.3, 1.215]}>
            <boxGeometry args={[0.16, 2.3, 0.05]} />
            <meshStandardMaterial color={color} roughness={0.55} />
          </mesh>
          <mesh position={[x, 1.3, -1.215]}>
            <boxGeometry args={[0.16, 2.3, 0.05]} />
            <meshStandardMaterial color={color} roughness={0.55} />
          </mesh>
        </group>
      ))}
      {/* a dark base rail, a thin frame round the roof (the roof itself stays in colour), a door end with lock bars */}
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[len + 0.04, 0.12, 2.45]} />
        <meshStandardMaterial color="#3d3f46" roughness={0.6} />
      </mesh>
      {[-1.2, 1.2].map((z) => (
        <mesh key={z} position={[0, 2.62, z]}>
          <boxGeometry args={[len + 0.04, 0.08, 0.1]} />
          <meshStandardMaterial color="#3d3f46" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[len / 2 + 0.02, 1.3, 0]}>
        <boxGeometry args={[0.06, 2.5, 2.3]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {[-0.5, -0.2, 0.2, 0.5].map((z) => (
        <mesh key={z} position={[len / 2 + 0.07, 1.3, z]}>
          <boxGeometry args={[0.05, 2.2, 0.05]} />
          <meshStandardMaterial color="#d7d3c8" metalness={0.4} roughness={0.4} />
        </mesh>
      ))}
      {/* a cream stencil band across the side */}
      <mesh position={[0, 1.75, 1.245]}>
        <planeGeometry args={[len * 0.55, 0.42]} />
        <meshStandardMaterial color={P.cream} roughness={0.8} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}


function Bollard({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.2, 0.26, 0.64, 12]} />
        <meshStandardMaterial color={P.ink} roughness={0.5} />
      </mesh>
      <mesh castShadow position={[0, 0.68, 0]}>
        <cylinderGeometry args={[0.3, 0.2, 0.12, 12]} />
        <meshStandardMaterial color={P.ink} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.25, 0.05, 6, 16]} />
        <meshStandardMaterial color="#d8b77e" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** A planter with a bush in it (Kenney Nature Kit). */
function Plant({ position, s = 1, seed = 0 }: { position: [number, number, number]; s?: number; seed?: number }) {
  return (
    <group position={position} scale={s}>
      <Suspense fallback={null}>
        <Prop src={MODEL.pot} size={1.3} rotation={seed} />
        <Prop src={MODEL.bush[seed % 2]} position={[0, 0.38, 0]} size={1.25} rotation={seed * 2.1} />
        {seed % 3 === 0 && <Prop src={MODEL.flower[seed % 3]} position={[0.22, 0.3, 0.12]} size={0.3} />}
      </Suspense>
    </group>
  );
}

function Lamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 2.2, 0]}>
        <cylinderGeometry args={[0.08, 0.11, 4.4, 8]} />
        <meshStandardMaterial color={P.steel} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0.35, 4.35, 0]} rotation={[0, 0, -0.3]}>
        <boxGeometry args={[0.8, 0.1, 0.1]} />
        <meshStandardMaterial color={P.steel} />
      </mesh>
      <mesh position={[0.7, 4.2, 0]}>
        <coneGeometry args={[0.28, 0.32, 12]} />
        <meshStandardMaterial color={P.yellow} emissive="#ffd27a" emissiveIntensity={lightNow().lamps ? 3 : 0.35} toneMapped={!lightNow().lamps} />
      </mesh>
    </group>
  );
}


function LifeRing({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow>
        <torusGeometry args={[0.42, 0.13, 10, 24]} />
        <meshStandardMaterial color={P.red} roughness={0.6} />
      </mesh>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} rotation={[0, 0, (k * Math.PI) / 2 + Math.PI / 4]} position={[Math.cos((k * Math.PI) / 2 + Math.PI / 4) * 0.42, Math.sin((k * Math.PI) / 2 + Math.PI / 4) * 0.42, 0]}>
          <torusGeometry args={[0.135, 0.02, 6, 12]} />
          <meshStandardMaterial color={P.cream} />
        </mesh>
      ))}
    </group>
  );
}

/** A dockside crane that slowly swings its boom, a container dangling from the hook. */
function Crane({ position }: { position: [number, number, number] }) {
  const boom = useRef<THREE.Group>(null);
  const load = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (boom.current) boom.current.rotation.y = Math.sin(t * 0.12) * 0.55 - 0.2;
    if (load.current) { load.current.rotation.z = Math.sin(t * 0.9) * 0.05; load.current.rotation.x = Math.cos(t * 0.7) * 0.04; }
  });
  return (
    <group position={position}>
      {[-1.6, 1.6].map((x) =>
        [-1.3, 1.3].map((z) => (
          <mesh key={`${x}${z}`} castShadow position={[x, 4.5, z]}>
            <boxGeometry args={[0.4, 9, 0.4]} />
            <meshStandardMaterial color={P.yellow} roughness={0.45} />
          </mesh>
        )),
      )}
      {[2.5, 6.5].map((y) => (
        <mesh key={y} castShadow position={[0, y, 0]}>
          <boxGeometry args={[3.6, 0.25, 2.9]} />
          <meshStandardMaterial color={P.yellow} roughness={0.45} />
        </mesh>
      ))}
      <group ref={boom} position={[0, 9.2, 0]}>
        <mesh castShadow>
          <boxGeometry args={[3.8, 0.9, 3]} />
          <meshStandardMaterial color={P.yellow} roughness={0.45} />
        </mesh>
        <mesh castShadow position={[-1.2, 0.95, 0]}>
          <boxGeometry args={[1.6, 1.0, 1.6]} />
          <meshStandardMaterial color={P.cream} roughness={0.6} />
        </mesh>
        <mesh castShadow position={[6, 0.4, 0]}>
          <boxGeometry args={[13, 0.5, 0.8]} />
          <meshStandardMaterial color={P.yellow} roughness={0.45} />
        </mesh>
        <group ref={load} position={[10.5, 0.2, 0]}>
          <mesh position={[0, -2, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 4, 4]} />
            <meshStandardMaterial color="#26262c" />
          </mesh>
          <Container position={[0, -6.6, 0]} color={P.teal} len={4.2} />
        </group>
      </group>
    </group>
  );
}



/** Gulls circle lazily over the water, wings flapping now and then. */
function Gulls() {
  const birds = useMemo(() => Array.from({ length: 5 }, (_, i) => ({ r: 7 + i * 2.2, h: 9 + (i % 3) * 1.5, s: 0.18 + i * 0.03, p: i * 1.7, cx: -6 + i * 4, cz: -22 - (i % 2) * 5 })), []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    birds.forEach((b, i) => {
      const g = refs.current[i]; if (!g) return;
      const a = t * b.s + b.p;
      g.position.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(t * 0.6 + b.p) * 0.4, b.cz + Math.sin(a) * b.r * 0.5);
      g.rotation.y = -a;
      const flap = Math.sin(t * 9 + b.p) * (Math.sin(t * 0.5 + b.p) > 0.2 ? 0.6 : 0.08);
      (g.children[1] as THREE.Object3D).rotation.x = flap; (g.children[2] as THREE.Object3D).rotation.x = -flap;
    });
  });
  return (
    <>
      {birds.map((_, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)}>
          <mesh>
            <capsuleGeometry args={[0.13, 0.4, 4, 8]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <group>
            <mesh position={[0, 0, 0.45]} rotation={[0, 0, Math.PI / 2]}>
              <boxGeometry args={[0.04, 0.3, 0.8]} />
              <meshStandardMaterial color="#e9eef2" />
            </mesh>
          </group>
          <group>
            <mesh position={[0, 0, -0.45]} rotation={[0, 0, Math.PI / 2]}>
              <boxGeometry args={[0.04, 0.3, 0.8]} />
              <meshStandardMaterial color="#e9eef2" />
            </mesh>
          </group>
        </group>
      ))}
    </>
  );
}

/** Bobs and rolls whatever it wraps on the swell (boats, buoys). */
function Bob({ children, position, phase = 0, amp = 0.12 }: { children: ReactNode; position: [number, number, number]; phase?: number; amp?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    if (g.current) { g.current.position.y = Math.sin(t * 1.1) * amp; g.current.rotation.z = Math.sin(t * 0.9) * amp * 0.3; g.current.rotation.x = Math.cos(t * 0.7) * amp * 0.25; }
  });
  return <group position={position}><group ref={g}>{children}</group></group>;
}

/** A stack of old tyres. */
function Tyres({ position, n = 3 }: { position: [number, number, number]; n?: number }) {
  return (
    <group position={position}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} castShadow receiveShadow position={[(i % 2) * 0.06, 0.16 + i * 0.3, 0]} rotation={[Math.PI / 2, 0, i * 0.4]}>
          <torusGeometry args={[0.42, 0.17, 10, 20]} />
          <meshStandardMaterial color="#45464f" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** A coil of mooring rope lying on the quay. */
function RopeCoil({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {[0.42, 0.32, 0.22].map((r, i) => (
        <mesh key={r} castShadow position={[0, 0.07 + i * 0.07, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r, 0.07, 8, 22]} />
          <meshStandardMaterial color="#d8b77e" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** Grass and the odd flower pushing up through the cracks and round the bottoms of things. */
function Weeds({ position, s = 1, seed = 1 }: { position: [number, number, number]; s?: number; seed?: number }) {
  const tufts = useMemo(() => {
    const r = rng(seed * 97 + 13);
    return Array.from({ length: 5 }, (_, i) => {
      const kind = i === 0 && r() < 0.6 ? 'flower' : 'grass';
      const list = kind === 'flower' ? MODEL.flower : MODEL.grass;
      return { src: list[Math.floor(r() * list.length)], x: (r() - 0.5) * 1.1, z: (r() - 0.5) * 0.7, k: kind === 'flower' ? 0.32 : 0.45 + r() * 0.35, rot: r() * 6.28 };
    });
  }, [seed]);
  return (
    <group position={position} scale={s}>
      <Suspense fallback={null}>
        {tufts.map((t, i) => <Prop key={i} src={t.src} position={[t.x, 0, t.z]} size={t.k} rotation={t.rot} />)}
      </Suspense>
    </group>
  );
}

// ───────────────────────────── in-play obstacles (exact footprints) ─────────────────────────────

/** A strapped stack of crates on the crate's square footprint (code-built: the stand-in while the models load). */
function CrateStack({ hw, hd, tex, seed }: { hw: number; hd: number; tex: THREE.Texture; seed: number }) {
  const turn = ((seed * 37) % 7) * 0.05 - 0.15;
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.7, 0]}>
        <boxGeometry args={[hw * 2, 1.4, hd * 2]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
      <mesh castShadow position={[hw * 0.18, 1.72, -hd * 0.12]} rotation={[0, turn, 0]}>
        <boxGeometry args={[hw * 1.15, 0.64, hd * 1.15]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
    </group>
  );
}

/**
 * Pirate crates (Kenney Pirate Kit) filling the footprint exactly: a long footprint gets a row of crates, each
 * stretched to its cell. Something sits on top: a smaller crate of bottles, a sack, or (on a stall) the catch.
 */
function Crates({ hw, hd, seed, top = 'crate' }: { hw: number; hd: number; seed: number; top?: 'crate' | 'catch' }) {
  const w = hw * 2, d = hd * 2;
  const alongX = w >= d;
  const n = Math.max(1, Math.round(Math.max(w, d) / Math.min(w, d)));
  const cell = Math.max(w, d) / n;
  const H = top === 'catch' ? 1.05 : 1.3;
  const r = rng(seed * 31 + 7);
  return (
    <group>
      {Array.from({ length: n }, (_, k) => {
        const off = -Math.max(w, d) / 2 + cell * (k + 0.5);
        const pos: [number, number, number] = alongX ? [off, 0, 0] : [0, 0, off];
        const fit: [number, number, number] = alongX ? [cell - 0.02, H, d] : [w, H, cell - 0.02];
        return (
          <group key={k}>
            <Prop src={MODEL.crate} position={pos} fit={fit} stretch />
            <mesh position={[pos[0], H * 0.78, pos[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[fit[0] * 0.86, fit[2] * 0.86]} />
              <meshStandardMaterial color={top === 'catch' ? '#e6f4f6' : '#d9b46a'} roughness={top === 'catch' ? 0.35 : 1} />
            </mesh>
          </group>
        );
      })}
      {top === 'crate' && (
        <>
          <Prop src={r() < 0.5 ? MODEL.crateBottles : MODEL.crate} position={[hw * 0.12, H, -hd * 0.1]} rotation={(r() - 0.5) * 0.5} fit={[Math.min(w, d) * 0.62, 0, Math.min(w, d) * 0.62]} />
          {r() < 0.5 && <Prop src={MODEL.sack} position={[-hw * 0.45, H, hd * 0.4]} size={Math.min(w, d) * 0.32} rotation={r() * 6} />}
        </>
      )}
      {top === 'catch' && (
        <>
          {/* fish laid in rows on the ice, a few mussels between them */}
          {Array.from({ length: 6 }, (_, k) => (
            <Prop key={k} src={MODEL.mackerel} tilt={Math.PI / 2} position={[((k % 3) - 1) * (w / 3.4) - w * 0.04, H * 0.78, (Math.floor(k / 3) - 0.5) * d * 0.36]} size={0.62} rotation={(r() - 0.5) * 0.5} />
          ))}
          {Array.from({ length: 4 }, (_, k) => (
            <Prop key={`m${k}`} src={MODEL.mussel} position={[(r() - 0.5) * w * 0.7, H * 0.8, (r() - 0.5) * d * 0.6]} size={0.2} rotation={r() * 6} />
          ))}
          <Prop src={MODEL.fishBucket} position={[alongX ? w * 0.42 : 0, H, alongX ? 0 : d * 0.42]} size={0.55} rotation={seed} />
        </>
      )}
    </group>
  );
}

/** A short shipping container on the long side obstacles' footprint. */
function MiniContainer({ hw, hd, color }: { hw: number; hd: number; color: string }) {
  const ribs = useMemo(() => Array.from({ length: Math.round((hd * 2) / 0.4) }, (_, i) => -hd + 0.2 + i * 0.4), [hd]);
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.85, 0]}>
        <boxGeometry args={[hw * 2, 1.7, hd * 2]} />
        <meshStandardMaterial color={color} roughness={0.65} metalness={0.1} />
      </mesh>
      {ribs.map((z) =>
        [-1, 1].map((sx) => (
          <mesh key={`${z}${sx}`} position={[sx * (hw + 0.02), 0.85, z]}>
            <boxGeometry args={[0.05, 1.5, 0.14]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        )),
      )}
      {/* a thin dark frame round the base and the roof edge, the roof itself in the container's colour */}
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[hw * 2 + 0.04, 0.1, hd * 2 + 0.04]} />
        <meshStandardMaterial color="#3d3f46" />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={`rx${sx}`} position={[sx * (hw - 0.03), 1.72, 0]}>
          <boxGeometry args={[0.1, 0.06, hd * 2 + 0.04]} />
          <meshStandardMaterial color="#3d3f46" />
        </mesh>
      ))}
      {[-1, 1].map((sz) => (
        <mesh key={`rz${sz}`} position={[0, 1.72, sz * (hd - 0.03)]}>
          <boxGeometry args={[hw * 2 + 0.04, 0.06, 0.1]} />
          <meshStandardMaterial color="#3d3f46" />
        </mesh>
      ))}
    </group>
  );
}

function Basin({ x, z, r, statue = true }: { x: number; z: number; r: number; statue?: boolean }) {
  const spec = useMemo(() => ({ x, z, r: r - 0.3 }), [x, z, r]);
  const mat = useWaterMaterial(spec);
  const ripples = useRef<(THREE.Mesh | null)[]>([]);
  const spout = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    mat.uniforms.uTime.value = t;
    ripples.current.forEach((m, i) => {
      if (!m) return;
      const k = (t * 0.45 + i / 3) % 1;
      m.scale.setScalar(0.4 + k * (r - 0.6));
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.55;
    });
    if (spout.current) spout.current.scale.set(1, 1 + Math.sin(t * 6) * 0.1, 1);
  });
  return (
    <group>
      {/* chunky stone rim, open so the water reads from above */}
      <mesh castShadow receiveShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[r, r + 0.12, 0.6, 48, 1, true]} />
        <meshStandardMaterial color="#b7b0a2" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[r - 0.34, r + 0.02, 48]} />
        <meshStandardMaterial color="#e5ded0" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[r - 0.32, r - 0.32, 0.36, 48, 1, true]} />
        <meshStandardMaterial color="#8f897c" roughness={0.9} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mat}>
        <circleGeometry args={[r - 0.3, 48, ]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => (ripples.current[i] = el)} position={[0, 0.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.92, 1, 40]} />
          <meshBasicMaterial color="#ffffff" transparent depthWrite={false} />
        </mesh>
      ))}
      {/* the fountain: a stone plinth with the anchor statue from the pirate kit (not on the market's ice tub) */}
      {statue && (
        <>
          <mesh castShadow position={[0, 0.75, 0]}>
            <cylinderGeometry args={[0.45, 0.6, 0.7, 16]} />
            <meshStandardMaterial color="#cfc8b9" roughness={0.8} />
          </mesh>
          <Suspense fallback={null}>
            <Prop src={MODEL.anchor} position={[0, 1.1, 0]} size={1.3} rotation={0.6} />
          </Suspense>
        </>
      )}
    </group>
  );
}

/** One obstacle, dressed by its tag. The footprint always matches the collision shape exactly. */
function Obstacle({ o, i, crateTex }: { o: (typeof OBSTACLES)[number]; i: number; crateTex: THREE.Texture }) {
  const colors = [P.blue, P.orange, P.teal, P.red];
  if (o.kind === 'circle') {
    if (o.tag === 'basin' || o.tag === 'tub') return <Basin x={o.x} z={o.z} r={o.r} statue={o.tag === 'basin'} />;
    // barrels: a tight cluster inside the circle
    const n = o.r > 0.8 ? 4 : 3;
    return (
      <Suspense fallback={null}>
        {Array.from({ length: n }, (_, k) => {
          const a = (k / n) * Math.PI * 2 + i, d = n === 4 ? o.r * 0.42 : o.r * 0.38;
          return <Prop key={k} src={MODEL.barrel} position={[Math.cos(a) * d, 0, Math.sin(a) * d]} size={o.r * 0.95} rotation={k * 1.3} />;
        })}
      </Suspense>
    );
  }
  const w = o.hw * 2, d = o.hd * 2;
  if (o.tag === 'crate') return (
    <Suspense fallback={<CrateStack hw={o.hw} hd={o.hd} tex={crateTex} seed={i} />}>
      <Crates hw={o.hw} hd={o.hd} seed={i} />
    </Suspense>
  );
  if (o.tag === 'stall') {
    // a fish stall: a counter of crates with the morning's catch laid out on top
    return (
      <Suspense fallback={<CrateStack hw={o.hw} hd={o.hd} tex={crateTex} seed={i + 7} />}>
        <Crates hw={o.hw} hd={o.hd} seed={i + 7} top="catch" />
      </Suspense>
    );
  }
  if (o.tag === 'stack') {
    return (
      <Suspense fallback={<MiniContainer hw={o.hw} hd={o.hd} color={colors[i % 4]} />}>
        <Prop src={MODEL.container[i % 3]} fit={[w, 2.1, d]} stretch />
        <Prop src={MODEL.container[(i + 1) % 3]} position={[0.12, 2.1, 0]} rotation={0.05} fit={[w * 0.92, 2.1, d * 0.92]} stretch />
      </Suspense>
    );
  }
  // container: the model stretched to the footprint, at a container's height
  return (
    <Suspense fallback={<MiniContainer hw={o.hw} hd={o.hd} color={colors[i % 4]} />}>
      <Prop src={MODEL.container[i % 3]} fit={[w, Math.min(2.4, 1.2 + Math.max(w, d) * 0.18), d]} stretch />
    </Suspense>
  );
}

// ───────────────────────────── the map ─────────────────────────────

export function Arena({ shadows }: { shadows: boolean }) {
  const L = lightNow();
  const deckTex = useMemo(makeDeckTexture, []);
  const quayTex = useMemo(makeQuayTexture, []);
  const hazardTex = useMemo(makeHazardTexture, []);
  const crateTex = useMemo(makeCrateTexture, []);
  const W = ARENA.halfWidth * 2;
  const D = ARENA.halfDepth * 2;
  const QUAY_Z = -13.3; // the quay lip: the sea starts beyond it

  return (
    <group>
      {/* the light for this match's time of day */}
      <hemisphereLight args={[L.hemiSky, L.hemiGround, L.hemiI]} />
      <ambientLight intensity={0.06} />
      <directionalLight
        position={L.sunPos}
        intensity={L.sunI}
        color={L.sun}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-near={1}
        shadow-camera-far={110}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      {L.lamps && (
        <>
          {[[-19, -9], [19, 8], [-6, -12.4], [8, 11.6]].map(([x, z]) => (
            <pointLight key={`${x}${z}`} position={[x, 4.2, z]} color="#ffc777" intensity={L.sunI < 1 ? 110 : 25} distance={18} decay={2} />
          ))}
        </>
      )}

      <Sea />

      {/* the quay around the bay */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 3]} receiveShadow>
        <planeGeometry args={[90, 32.6]} />
        <meshStandardMaterial map={quayTex} roughness={0.95} />
      </mesh>
      {/* the ground the town stands on, behind the near quay */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 32]} receiveShadow>
        <planeGeometry args={[90, 26]} />
        <meshStandardMaterial map={quayTex} roughness={0.95} />
      </mesh>
      {/* quay wall face down to the water, its lip painted in hazard stripes */}
      <mesh position={[0, -0.5, QUAY_Z - 0.05]} receiveShadow>
        <boxGeometry args={[90, 1, 0.3]} />
        <meshStandardMaterial color="#8c867a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.02, QUAY_Z + 0.25]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[90, 0.5]} />
        <meshStandardMaterial map={hazardTex} roughness={0.7} />
      </mesh>
      {/* tyre fenders hanging over the edge */}
      {[-30, -21, -12, -3, 6, 15, 24, 33].map((x) => (
        <mesh key={x} position={[x, -0.45, QUAY_Z - 0.32]} rotation={[0, 0, 0]} castShadow>
          <torusGeometry args={[0.42, 0.18, 10, 18]} />
          <meshStandardMaterial color="#25252b" roughness={0.9} />
        </mesh>
      ))}

      {/* the playable bay */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={deckTex} roughness={0.9} />
      </mesh>
      {/* a low painted kerb around the bay (never tall enough to hide anyone) */}
      {[
        [0, -ARENA.halfDepth - 0.14, W + 0.56, 0.28],
        [0, ARENA.halfDepth + 0.14, W + 0.56, 0.28],
      ].map(([x, z, w, d], i) => (
        <mesh key={`h${i}`} position={[x, 0.07, z]} receiveShadow castShadow>
          <boxGeometry args={[w, 0.14, d]} />
          <meshStandardMaterial map={hazardTex} roughness={0.6} />
        </mesh>
      ))}
      {[-1, 1].map((sx) => (
        <mesh key={`v${sx}`} position={[sx * (ARENA.halfWidth + 0.14), 0.07, 0]} receiveShadow castShadow>
          <boxGeometry args={[0.28, 0.14, D]} />
          <meshStandardMaterial color={P.line} roughness={0.6} />
        </mesh>
      ))}
      {/* back railing along the quay */}
      {Array.from({ length: 23 }, (_, i) => -22 + i * 2).map((x) => (
        <mesh key={`rail${x}`} position={[x, 0.5, QUAY_Z + 0.7]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 1, 6]} />
          <meshStandardMaterial color={P.blue} roughness={0.5} />
        </mesh>
      ))}
      {[0.98, 0.55].map((y) => (
        <mesh key={y} position={[0, y, QUAY_Z + 0.7]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.045, 0.045, 44, 6]} />
          <meshStandardMaterial color={P.blue} roughness={0.5} />
        </mesh>
      ))}

      {/* obstacles: exact footprints from the live layout, dressed by tag */}
      {OBSTACLES.map((o, i) => (
        <group key={`${o.tag}${i}`} position={[o.x, 0, o.z]}>
          <Obstacle o={o} i={i} crateTex={crateTex} />
        </group>
      ))}

      <Suspense fallback={null}>
        {/* container yards either side */}
        {[
          [-24.5, 0, -7, 0], [-24.5, 0, 0, 1], [-24.5, 2.5, -3.5, 2], [-27.6, 0, -3.5, 1], [-24.5, 0, 7, 2],
          [24.5, 0, -6, 1], [24.5, 2.5, -6, 0], [24.5, 0, 1.5, 2], [27.6, 0, 5, 0],
        ].map(([x, y, z, k], i) => (
          <Prop key={i} src={MODEL.container[k]} position={[x, y, z]} fit={[2.5, 0, 6]} stretch />
        ))}
        <Prop src={MODEL.container[0]} position={[-16, 0, -11.4]} fit={[5, 0, 2.4]} stretch />
        <Prop src={MODEL.container[2]} position={[17, 0, -11.4]} fit={[5, 0, 2.4]} stretch />

        {/* the harbour: a wooden pier, real boats bobbing, buoys */}
        <Prop src={MODEL.dock} position={[12.5, -0.15, -15.6]} size={7} rotation={Math.PI / 2} />
        <Bob phase={0} position={[15, -0.9, -20.5]}><Prop src={MODEL.tug} size={8} rotation={-Math.PI / 2 + 0.1} /></Bob>
        <Bob phase={1.7} position={[-22, -0.9, -24]}><Prop src={MODEL.fishing} size={7} rotation={0.3} /></Bob>
        <Bob phase={3.1} amp={0.06} position={[32, -0.9, -40]}><Prop src={MODEL.cargoShip} size={26} rotation={-0.15} /></Bob>
        <Bob phase={2.4} position={[-4, -0.9, -30]}><Prop src={MODEL.sailboat} size={6} rotation={1.2} /></Bob>
        <Bob phase={4.2} amp={0.09} position={[-34, -0.9, -31]}><Prop src={MODEL.pirateShip} size={14} rotation={0.5} /></Bob>

        {/* flags along the quay, cannons pointing out to sea */}
        <Prop src={MODEL.flagPirate} position={[-23.2, 0, -12.4]} size={2.2} rotation={-0.3} />
        <Prop src={MODEL.flagPennant} position={[23.4, 0, -12.2]} size={2.2} rotation={0.4} />
        <Prop src={MODEL.flagPennant} position={[-23.4, 0, 10.8]} size={2} rotation={2.6} />
        <Prop src={MODEL.cannon} position={[1.2, 0, -12.1]} size={1.5} rotation={Math.PI / 2} />
        <Prop src={MODEL.cannon} position={[13.2, 0, -12.1]} size={1.5} rotation={Math.PI / 2 - 0.15} />
        <Bob phase={0.6} amp={0.15} position={[3, -0.9, -17.5]}><Prop src={MODEL.buoyFlag} size={1.1} /></Bob>
        <Bob phase={1.9} amp={0.15} position={[-13, -0.9, -19]}><Prop src={MODEL.buoy} size={1} /></Bob>
        <Bob phase={2.8} amp={0.15} position={[24, -0.9, -17]}><Prop src={MODEL.buoy} size={1} /></Bob>

        {/* dressing on the quay (outside the bay) */}
        {[[-21, -11.6], [-20.1, -12.2], [-21.2, -10.5], [20.4, 10.4], [21.3, 9.7], [20.6, -11.4]].map(([x, z], i) => (
          <Prop key={i} src={MODEL.barrel} position={[x, 0, z]} size={0.95} rotation={i * 0.9} />
        ))}
        <Prop src={MODEL.fishBucket} position={[-19.8, 0, 9.4]} size={1} rotation={0.4} />
        <Prop src={MODEL.fishBucket} position={[6.6, 0, -12.2]} size={0.9} rotation={-0.3} />
        <Prop src={MODEL.chest} position={[21.2, 0, -2.4]} size={1.3} rotation={-Math.PI / 2 + 0.2} />
        <Prop src={MODEL.crateBottles} position={[-21.3, 0, 1.4]} size={1.2} rotation={0.3} />
        <Prop src={MODEL.crate} position={[21.4, 0, 1.2]} size={1.2} rotation={-0.2} />
        <Prop src={MODEL.sack} position={[20.6, 0, 2.6]} size={0.7} rotation={1} />
        <Prop src={MODEL.fishBones} position={[-9.4, 0, 11.2]} size={0.6} rotation={0.8} />
        <Prop src={MODEL.anchor} position={[-11.2, 0, -12.3]} size={1.6} rotation={0.2} />
        <Prop src={MODEL.palm1} position={[-21.6, 0, 4.8]} size={4.5} />
        <Prop src={MODEL.palm2} position={[21.8, 0, 4.2]} size={4.5} rotation={1} />
        {/* the harbour town behind the near quay: only the menu's camera ever turns round to see it */}
        {([[-27, 2, 0.1], [-14.5, 0, -0.05], [-4, 1, 0], [3.5, 2, 0.06], [16, 0, 0.04], [27.5, 1, -0.1]] as const).map(([x, k, r], i) => (
          <Prop key={`h${i}`} src={MODEL.house[k]} position={[x, 0, 25.5 + (i % 2) * 1.2]} rotation={Math.PI + r} />
        ))}
        <Prop src={MODEL.palm3} position={[-8.6, 0, 22.4]} size={4} rotation={0.5} />
        <Prop src={MODEL.palm1} position={[10.2, 0, 22.8]} size={4.4} rotation={2.1} />
        <Prop src={MODEL.palm2} position={[22, 0, 22]} size={4} rotation={1.2} />
        <Prop src={MODEL.rock} position={[-29, -0.5, -13.4]} size={3} />
        <Prop src={MODEL.rock} position={[30, -0.5, -13.6]} size={3.4} rotation={2} />
      </Suspense>
      <Crane position={[-6, 0, -16.5]} />
      <Gulls />

      {/* edge clutter: tyres, rope, weeds in the cracks and at the feet of the containers */}
      <Tyres position={[-21.4, 0, -6.6]} n={3} />
      <Tyres position={[21.6, 0, 7.2]} n={2} />
      <Tyres position={[-7.2, 0, -12.4]} n={2} />
      <RopeCoil position={[-14.2, 0, -12.2]} />
      <RopeCoil position={[16.6, 0, 11.6]} />
      <RopeCoil position={[-10.8, 0, 11.7]} />
      {[
        [-18.6, -10.2, 1.2, 1], [18.4, -10.4, 1, 2], [-18.7, 10.2, 1.1, 3], [18.5, 10.1, 0.9, 4],
        [-22.9, -9.9, 1.3, 5], [-22.9, 4.1, 1, 6], [23, -2.6, 1.2, 7], [26.2, 7.9, 1, 8],
        [-4.5, -10.6, 0.7, 9], [6.2, 10.7, 0.7, 10], [-12.6, 10.6, 0.6, 11], [13.8, -10.6, 0.6, 12],
      ].map(([x, z, k, sd]) => (
        <Weeds key={sd} position={[x, 0, z]} s={k} seed={sd} />
      ))}
      {[-15, -9, -3, 3, 9, 15].map((x) => (
        <Bollard key={x} position={[x, 0, ARENA.halfDepth + 1.3]} />
      ))}
      {[-12, 0, 12].map((x) => (
        <Bollard key={`q${x}`} position={[x + 4.5, 0, QUAY_Z + 0.4]} />
      ))}
      <Lamp position={[-19.6, 0, -9]} />
      <Lamp position={[19.6, 0, 8]} />
      <Lamp position={[-6.6, 0, -12.6]} />
      <Lamp position={[7.4, 0, 11.8]} />
      <LifeRing position={[-8.5, 0.62, QUAY_Z + 0.76]} />
      <LifeRing position={[9.5, 0.62, QUAY_Z + 0.76]} />
      <Plant position={[-20.6, 0, 6.6]} s={1.2} seed={0} />
      <Plant position={[20.4, 0, -0.6]} s={1.1} seed={1} />
      <Plant position={[-20.2, 0, -2.8]} seed={2} />
      <Plant position={[19.8, 0, -9.6]} s={0.9} seed={3} />
      <Plant position={[-6.4, 0, 11.9]} s={0.8} seed={4} />
      <Plant position={[10.8, 0, -11.6]} s={0.8} seed={5} />
    </group>
  );
}
