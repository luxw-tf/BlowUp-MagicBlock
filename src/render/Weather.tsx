/**
 * The weather layer: rain streaks, lightning with thunder, and the weather's sound bed. Purely visual and local:
 * the weather itself is picked in game/arena.ts (the same for everyone in a match); flash timing is each client's own.
 * The look of the sky, fog, deck and water for each weather is in weatherLook.ts.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { audio } from '../audio/audio';
import { currentWeather } from '../game/arena';
import { AMBIENT, type Look } from './weatherLook';

// ───────────────────────────── rain ─────────────────────────────

const RAIN_VERT = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aEnd;
  uniform float uTime, uWind;
  uniform vec2 uWindDir;
  uniform vec3 uBox, uOrigin;
  varying float vA;
  #include <fog_pars_vertex>
  void main() {
    float speed = 21.0 * (0.85 + aSeed.y * 0.3);
    float y = mod(aSeed.y * uBox.y * 7.0 - uTime * speed, uBox.y);
    vec3 p = vec3(aSeed.x * uBox.x, y, aSeed.z * uBox.z) + uOrigin;
    vec2 slant = uWindDir * uWind * 0.35;                       // wind leans the rain over
    p.xz += slant * (uBox.y - y);                                // falls downwind
    // the tail trails back up the drop's path
    p += vec3(-slant.x, 1.0, -slant.y) * aEnd * (0.55 + 0.25 * aSeed.z);
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vA = (1.0 - aEnd) * smoothstep(0.0, 1.5, y);                // bright head, fading tail; gone at the ground
    #include <fog_vertex>
  }
`;
const RAIN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity, uFlash;
  varying float vA;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(uColor + uFlash * 0.6, vA * uOpacity * (1.0 + uFlash));
    #include <fog_fragment>
  }
`;

/** Rain as one batch of line segments falling through a box over the bay, all moved in the vertex shader. */
function Rain({ amount, night }: { amount: number; night: boolean }) {
  const n = Math.round(2200 * Math.min(amount, 1.5));
  const { geo, mat } = useMemo(() => {
    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const seed = new Float32Array(n * 6), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = rnd(), b = rnd(), c = rnd();
      seed.set([a, b, c, a, b, c], i * 6);
      end[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); // unused, three wants one
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: AMBIENT.uTime, uWind: AMBIENT.uWind, uWindDir: AMBIENT.uWindDir, uFlash: AMBIENT.uFlash,
        uBox: { value: new THREE.Vector3(70, 24, 50) },
        uOrigin: { value: new THREE.Vector3(-33, 0, -26) },
        uColor: { value: new THREE.Color(night ? '#9fb4d6' : '#f2f7fc') },
        uOpacity: { value: night ? 0.7 : 0.75 },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    return { geo, mat };
  }, [n, night]);
  useLayoutEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />;
}

// ───────────────────────────── snow ─────────────────────────────

const SNOW_VERT = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime, uWind, uPx;
  uniform vec2 uWindDir;
  uniform vec3 uBox, uOrigin;
  varying float vA;
  #include <fog_pars_vertex>
  void main() {
    float speed = 1.5 + aSeed.y * 1.1;
    float y = mod(aSeed.y * uBox.y * 5.0 - uTime * speed, uBox.y);
    vec3 p = vec3(aSeed.x * uBox.x, y, aSeed.z * uBox.z);
    p.xz += uWindDir * uTime * uWind * 2.2;                         // blown downwind...
    p.x += sin(uTime * 1.3 + aSeed.z * 40.0) * 0.6;                 // ...tumbling as it falls
    p.z += cos(uTime * 1.1 + aSeed.x * 33.0) * 0.5;
    p.x = mod(p.x, uBox.x);
    p.z = mod(p.z, uBox.z);
    p += uOrigin;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = min((3.5 + aSeed.x * 3.5) * uPx * (60.0 / max(1.0, -mvPosition.z)), 16.0 * uPx);
    vA = smoothstep(0.0, 1.0, y);
    #include <fog_vertex>
  }
`;
const SNOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  #include <fog_pars_fragment>
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.15, d) * vA * 0.9;
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
  }
`;

/** Snowflakes drifting down and downwind: one draw call of points. */
function Snow({ amount, night }: { amount: number; night: boolean }) {
  const { gl } = useThree();
  const n = Math.round(1500 * amount);
  const { geo, mat } = useMemo(() => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) seed[i] = rnd();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // unused, three wants one
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: AMBIENT.uTime, uWind: AMBIENT.uWind, uWindDir: AMBIENT.uWindDir,
        uPx: { value: gl.getPixelRatio() },
        uBox: { value: new THREE.Vector3(70, 20, 50) },
        uOrigin: { value: new THREE.Vector3(-35, 0, -26) },
        uColor: { value: new THREE.Color(night ? '#c9d6ee' : '#ffffff') },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    return { geo, mat };
  }, [n, night, gl]);
  useLayoutEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />;
}

// ───────────────────────────── wind you can see ─────────────────────────────

const GUST_VERT = /* glsl */ `
  attribute float aT;      // 0 tail .. 1 head along the streak
  attribute float aSide;   // -1 / 1 across it
  attribute vec3 aSeed;
  uniform float uTime, uWind;
  uniform vec2 uWindDir;
  varying float vA;
  varying float vSide;
  float gh(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float life = 2.6 + aSeed.y * 1.4;
    float k = uTime / life + aSeed.x;
    float cyc = floor(k), ph = fract(k);
    // each pass starts somewhere new over the bay
    vec3 o = vec3(-24.0 + gh(cyc * 12.9 + aSeed.z * 78.2) * 48.0, 0.5 + gh(cyc * 4.1 + aSeed.x * 9.7) * 2.6, -13.0 + gh(cyc * 7.3 + aSeed.y * 31.1) * 24.0);
    vec2 dir = uWindDir;
    vec2 side = vec2(-dir.y, dir.x);
    float len = 3.0 + 2.5 * aSeed.z;
    float travel = 9.0 + uWind * 8.0;
    float along = (ph - 0.5) * travel - (1.0 - aT) * len;
    // a lazy ripple along the line
    float wave = sin(along * 0.8 + aSeed.z * 6.0 + uTime * 1.6) * 0.18;
    vec3 p = o + vec3(dir.x, 0.0, dir.y) * along + vec3(side.x, 0.0, side.y) * wave;
    p.y += sin(along * 0.6 + aSeed.x * 5.0) * 0.25;
    // a hair-thin wisp: widest in the middle, tapering to nothing at both ends
    float w = 0.045 * sin(3.14159 * aT);
    p += vec3(side.x, 0.0, side.y) * aSide * w;
    p.y += aSide * w * 0.6;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vSide = aSide;
    // fades in and out over its pass, and along its length: faint tail, brighter towards the head
    vA = sin(3.14159 * ph) * smoothstep(0.0, 0.6, aT) * smoothstep(1.0, 0.85, aT);
  }
`;
const GUST_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vA;
  varying float vSide;
  void main() {
    float a = vA * (1.0 - vSide * vSide) * uOpacity;   // soft across its width
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/** White streaks racing over the deck downwind (the wind lines of a cartoon): one draw call. */
function Gusts({ amount, night }: { amount: number; night: boolean }) {
  const n = Math.round(14 * amount);
  const { geo, mat } = useMemo(() => {
    const SEG = 24;
    const t: number[] = [], side: number[] = [], pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      for (const s of [-1, 1]) { t.push(i / SEG); side.push(s); pos.push(0, 0, 0); }
      if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    let s = 23;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) seed[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      vertexShader: GUST_VERT,
      fragmentShader: GUST_FRAG,
      uniforms: {
        uTime: AMBIENT.uTime, uWind: AMBIENT.uWind, uWindDir: AMBIENT.uWindDir,
        uOpacity: { value: night ? 0.28 : 0.45 }, uColor: { value: new THREE.Color(night ? '#a9b9d6' : '#ffffff') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return { geo, mat };
  }, [n, night]);
  useLayoutEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />;
}

// ───────────────────────────── lightning ─────────────────────────────

/** A jagged bolt as a thin ribbon from the clouds to the sea, rebuilt for each strike. */
function boltGeometry(x: number, z: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  let px = x, y = 48;
  while (y > -1) {
    pts.push(new THREE.Vector3(px, y, z));
    y -= 2.5 + Math.random() * 4;
    px += (Math.random() - 0.5) * 6;
  }
  pts.push(new THREE.Vector3(px, -1, z));
  const pos: number[] = [];
  const w = 0.55;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const k = w * (1 - i / pts.length) + 0.15;
    pos.push(a.x - k, a.y, a.z, a.x + k, a.y, a.z, b.x + k, b.y, b.z, a.x - k, a.y, a.z, b.x + k, b.y, b.z, b.x - k, b.y, b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/**
 * Every 6 to 16 seconds: a double flicker that lights the whole scene (a cold ambient light and the sky), a bolt
 * out over the sea, and thunder a moment later (sooner and louder the closer the strike).
 */
function Lightning() {
  const { scene } = useThree();
  const amb = useRef<THREE.AmbientLight>(null);
  const bolt = useRef<THREE.Mesh>(null);
  const st = useRef({ next: 4 + Math.random() * 5, at: -10, near: 0.5 });
  const sky = useMemo(() => new THREE.Color(), []);
  const flashCol = useMemo(() => new THREE.Color('#9fb3e0'), []);
  const boltMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#eef3ff', fog: false, transparent: true, side: THREE.DoubleSide }), []);
  useEffect(() => {
    if (scene.background instanceof THREE.Color) sky.copy(scene.background);
    const bg = scene.background;
    return () => {
      if (bg instanceof THREE.Color) bg.copy(sky);
      AMBIENT.uFlash.value = 0;
      boltMat.dispose();
    };
  }, [scene, sky, boltMat]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime, s = st.current;
    if (t >= s.next) {
      s.at = t;
      s.next = t + 6 + Math.random() * 10;
      s.near = Math.random();
      if (bolt.current) {
        bolt.current.geometry.dispose();
        // a close strike hits the harbour (its foot shows over the sea at the top of the match view), a far one the horizon
        bolt.current.geometry = boltGeometry((Math.random() - 0.5) * (s.near > 0.6 ? 40 : 100), s.near > 0.6 ? -26 - Math.random() * 10 : -70 - (1 - s.near) * 50);
      }
      audio.thunder(s.near);
    }
    const k = t - s.at;
    // two quick flashes then a fading afterglow
    const f = k < 0 || k > 0.9 ? 0 : k < 0.07 ? 1 : k < 0.14 ? 0.25 : k < 0.22 ? 0.85 : Math.max(0, 0.5 * (1 - (k - 0.22) / 0.68));
    const flash = f * (0.55 + 0.45 * s.near);
    AMBIENT.uFlash.value = flash;
    if (amb.current) amb.current.intensity = flash * 2.6;
    if (scene.background instanceof THREE.Color) scene.background.copy(sky).lerp(flashCol, flash * 0.7);
    if (bolt.current) {
      bolt.current.visible = k < 0.3;
      boltMat.opacity = k < 0.07 || (k > 0.14 && k < 0.22) ? 1 : 0.35;
    }
  });
  return (
    <>
      <ambientLight ref={amb} color="#c8d6ff" intensity={0} />
      <mesh ref={bolt} material={boltMat} visible={false} frustumCulled={false} />
    </>
  );
}

// ───────────────────────────── the layer ─────────────────────────────

/** Rain, lightning and the weather's sound. `quiet`: a softer sound bed (the menu). */
export function WeatherLayer({ look, night, quiet = false }: { look: Look; night: boolean; quiet?: boolean }) {
  const w = currentWeather();
  useEffect(() => {
    // you hear the wind whenever you can see it
    audio.startWeather({ rain: look.rain, wind: look.gusts > 0 ? Math.max(look.wind, 0.9) : look.wind, gain: quiet ? 0.55 : 1 });
    return () => audio.stopWeather();
  }, [w, look, quiet]);
  return (
    <>
      {look.rain > 0 && <Rain amount={look.rain} night={night} />}
      {look.snow > 0 && <Snow amount={look.snow} night={night} />}
      {look.gusts > 0 && <Gusts amount={look.gusts} night={night} />}
      {look.lightning && <Lightning />}
    </>
  );
}
