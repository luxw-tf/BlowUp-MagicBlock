/**
 * Ambient life on the dock, always on and cheap: everything here moves in a shader off one shared clock (AMBIENT in
 * weatherLook.ts), so there is a single useFrame for the lot and each particle system is one draw call.
 * - <Windy>: palms and flags sway and flutter in the wind (vertex shader, shadows included)
 * - groundMaterial(): drifting cloud shadows and the wet sheen, puddles and rain rings on the deck
 * - <Smoke>: smoke curling from the ships' funnels
 * - <Motes>: dust and leaves by day, fireflies at night
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { AMBIENT, type Look } from './weatherLook';
import { TRACK_RECT, resetTracks, trackTexture } from './snowTracks';
import type { Obstacle } from '../game/arena';

/** One clock and one wind for every ambient shader. */
export function AmbientClock({ look }: { look: Look }) {
  useLayoutEffect(() => {
    AMBIENT.uWind.value = look.wind;
    AMBIENT.uRain.value = look.rain;
    AMBIENT.uClouds.value = look.clouds;
    AMBIENT.uWet.value = look.wet;
    AMBIENT.uSnow.value = look.snow;
    AMBIENT.uSnowBuild.value = 0;
    AMBIENT.uFlash.value = 0;
    resetTracks();
  }, [look]);
  const born = useRef(-1);
  useFrame(({ clock }) => {
    AMBIENT.uTime.value = clock.elapsedTime;
    // snow settles over the first minute or so: a dusting first, then the drifts fill in
    if (born.current < 0) born.current = clock.elapsedTime;
    if (look.snow > 0) AMBIENT.uSnowBuild.value = Math.min(1, 0.15 + (clock.elapsedTime - born.current) / 70);
  });
  return null;
}

// ───────────────────────────── wind sway ─────────────────────────────

const SWAY_PARS = /* glsl */ `
  uniform float uTime, uWind, uWBase, uWHeight, uWAmp, uWFlutter, uWPhase;
  uniform vec2 uWindDir;
`;
/** Bend in world space: nothing at the foot, the most at the top (squared), a slow sway plus a quick flutter. */
const SWAY_MAIN = /* glsl */ `
  vec4 wPos = modelMatrix * vec4(transformed, 1.0);
  float wh = clamp((wPos.y - uWBase) / uWHeight, 0.0, 1.0); wh *= wh;
  float gust = 0.6 + 0.4 * sin(uTime * 0.37 + wPos.x * 0.04 + uWPhase);
  float sway = (sin(uTime * 1.25 + uWPhase) * 0.45 + 0.55) * uWind * gust;
  vec2 wd = uWindDir * sway * uWAmp * wh;
  wd += vec2(sin(uTime * 7.1 + wPos.y * 3.0 + wPos.x * 1.7), cos(uTime * 6.3 + wPos.y * 2.3 + wPos.z * 1.3)) * uWFlutter * wh * (0.25 + uWind);
  wPos.xz += wd;
`;

function swayUniforms(base: number, height: number, amp: number, flutter: number, phase: number) {
  return {
    uTime: AMBIENT.uTime, uWind: AMBIENT.uWind, uWindDir: AMBIENT.uWindDir,
    uWBase: { value: base }, uWHeight: { value: Math.max(0.1, height) }, uWAmp: { value: amp }, uWFlutter: { value: flutter }, uWPhase: { value: phase },
  };
}

function patchSway(mat: THREE.Material, u: ReturnType<typeof swayUniforms>) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_PARS}`)
      .replace('#include <project_vertex>', `${SWAY_MAIN}\n  vec4 mvPosition = viewMatrix * wPos;\n  gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'amb-sway';
}

/**
 * Wraps models (inside the same Suspense boundary, so they are loaded when this runs) and makes them sway.
 * `amp`: how far the top leans in a stiff breeze (world units); `flutter`: the quick shake (flags, fronds).
 */
export function Windy({ children, amp = 0.35, flutter = 0.03, phase = 0 }: { children: ReactNode; amp?: number; flutter?: number; phase?: number }) {
  const g = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const root = g.current;
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    const u = swayUniforms(box.min.y, box.max.y - box.min.y, amp, flutter, phase);
    const made: THREE.Material[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const mat = m.material.clone();
      patchSway(mat, u);
      m.material = mat;
      // the shadow sways with it
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      patchSway(depth, u);
      m.customDepthMaterial = depth;
      made.push(mat, depth);
    });
    return () => made.forEach((x) => x.dispose());
  }, [amp, flutter, phase]);
  return <group ref={g}>{children}</group>;
}

// ───────────────────────────── the deck: clouds, wet ─────────────────────────────

const GROUND_FUNCS = /* glsl */ `
  uniform float uTime, uWind, uClouds, uWet, uRain, uFlash, uSnow, uSnowBuild;
  uniform vec2 uWindDir;
  uniform vec3 uSkyRefl;
  uniform vec4 uObs[12];     // obstacles for snow drifts: x, z, then r and -1 (circle) or half width and half depth (box)
  uniform int uObsN;
  uniform sampler2D uTrack;  // footprints (snowTracks.ts)
  uniform vec4 uTrackRect;
  varying vec3 vGW;
  float amb_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float amb_noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(amb_hash(i), amb_hash(i + vec2(1, 0)), f.x), mix(amb_hash(i + vec2(0, 1)), amb_hash(i + vec2(1, 1)), f.x), f.y);
  }
`;
const GROUND_DIFFUSE = /* glsl */ `
  #include <map_fragment>
  float puddle = 0.0;
  float ripple = 0.0;
  if (uClouds > 0.0) {
    // big soft cloud shadows drifting downwind
    vec2 cp = vGW.xz * 0.03 - uWindDir * uTime * (0.015 + 0.03 * uWind);
    float n = amb_noise(cp) * 0.65 + amb_noise(cp * 2.3 + 7.1) * 0.35;
    diffuseColor.rgb *= 1.0 - smoothstep(0.5, 0.75, n) * 0.3 * uClouds;
  }
  if (uWet > 0.0) {
    float pn = amb_noise(vGW.xz * 0.21 + 3.0) * 0.72 + amb_noise(vGW.xz * 0.95) * 0.28;
    puddle = smoothstep(0.555, 0.63, pn) * uWet;
    diffuseColor.rgb *= mix(1.0, 0.74, uWet);                          // damp concrete
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, puddle);
    if (uRain > 0.0) {
      // drops landing: little rings that spread and fade, one per cell at its own moment
      vec2 rp = vGW.xz * 1.25;
      vec2 ci = floor(rp);
      vec2 off = vec2(amb_hash(ci + 1.3), amb_hash(ci + 2.7)) - 0.5;
      float ph = fract(uTime * (0.9 + 0.5 * min(uRain, 1.5)) + amb_hash(ci));
      float rr = length(fract(rp) - 0.5 - off * 0.5);
      ripple = smoothstep(0.03, 0.0, abs(rr - ph * 0.38)) * (1.0 - ph) * (1.0 - ph) * min(uRain, 1.0);
    }
  }
  if (uSnow > 0.0) {
    vec2 gp = vGW.xz;
    vec2 side = vec2(-uWindDir.y, uWindDir.x);
    // drifts: snow banks up against everything in the way, deepest on the downwind (lee) side, and along the bay's edges
    float drift = 0.0;
    for (int i = 0; i < 12; i++) {
      if (i >= uObsN) break;
      vec4 o = uObs[i];
      vec2 rel = gp - o.xy;
      float d;
      if (o.w < 0.0) d = length(rel) - o.z;
      else { vec2 q = abs(rel) - o.zw; d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
      float lee = dot(normalize(rel + 1e-4), uWindDir);
      float reach = 0.7 + 1.6 * max(lee, 0.0);
      drift = max(drift, smoothstep(reach, 0.0, d) * (0.75 + 0.25 * lee));
    }
    vec2 e = vec2(18.0, 10.0) - abs(gp);
    float edge = min(e.x, e.y);
    drift = max(drift, smoothstep(1.1, 0.0, abs(edge)) * 0.85);
    drift *= 0.75 + 0.5 * amb_noise(gp * 0.8 + 5.0);                     // lumpy, not ruled lines
    // the open deck: a patchy dusting, swept thin in long streaks along the wind
    vec2 wp = vec2(dot(gp, uWindDir), dot(gp, side));
    float sn = amb_noise(vec2(wp.x * 0.18, wp.y * 0.55) + 11.0) * 0.6 + amb_noise(gp * 0.9 + 3.0) * 0.25 + amb_noise(gp * 3.1) * 0.15;
    float open = smoothstep(0.3, 0.8, sn) * 0.7;
    // it settles over the match: a thin dusting first, the drifts filling in
    float build = uSnowBuild;
    float cover = max(open * build, smoothstep(0.0, 1.0, drift * (0.35 + 0.9 * build)));
    // footprints: wherever anyone walked the snow is trodden away, then fills back in
    vec2 tuv = (gp - uTrackRect.xy) / uTrackRect.zw;
    float track = (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) ? texture2D(uTrack, tuv).r : 1.0;
    cover *= mix(0.15, 1.0, track);
    cover *= uSnow;
    // deep snow is bright; a cold blue shade at the toe of each drift gives it some body
    vec3 snowCol = mix(vec3(0.8, 0.86, 0.95), vec3(0.95, 0.97, 1.0), smoothstep(0.3, 0.9, cover));
    diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, clamp(cover, 0.0, 1.0));
    diffuseColor.rgb *= 1.0 - 0.12 * (smoothstep(0.2, 0.45, cover) - smoothstep(0.45, 0.8, cover));
    // trodden slush: damp and darker
    diffuseColor.rgb *= mix(0.82, 1.0, track);
    // powder blowing across the ground in wisps, racing downwind
    float blow = amb_noise(vec2(wp.x * 0.7 - uTime * (1.4 + 2.5 * uWind), wp.y * 3.5));
    blow = smoothstep(0.62, 0.9, blow) * amb_noise(gp * 0.25 - uWindDir * uTime * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.98, 1.0), blow * 0.55 * uSnow);
  }
`;
const GROUND_ROUGH = /* glsl */ `
  #include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.5, uWet * 0.7);
  roughnessFactor = mix(roughnessFactor, 0.06, puddle);
`;
const GROUND_EMISSIVE = /* glsl */ `
  #include <emissivemap_fragment>
  // a puddle mirrors the sky (and the lightning), and rings where the rain lands
  totalEmissiveRadiance += (uSkyRefl * 0.3 + vec3(uFlash * 0.5)) * puddle + (uSkyRefl * 0.5 + 0.1) * ripple * (0.02 + 0.22 * puddle) * uWet;
`;

/**
 * The deck and quay material: a plain standard material with clouds, wetness and snow worked in. `obstacles` are
 * what the snow drifts against (the live layout).
 */
export function groundMaterial(map: THREE.Texture, sky: string, obstacles: readonly Obstacle[] = []): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
  const sk = { value: new THREE.Color(sky) };
  const obs = Array.from({ length: 12 }, (_, i) => {
    const o = obstacles[i];
    if (!o) return new THREE.Vector4();
    return o.kind === 'circle' ? new THREE.Vector4(o.x, o.z, o.r, -1) : new THREE.Vector4(o.x, o.z, o.hw, o.hd);
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTime: AMBIENT.uTime, uWind: AMBIENT.uWind, uWindDir: AMBIENT.uWindDir, uClouds: AMBIENT.uClouds,
      uWet: AMBIENT.uWet, uRain: AMBIENT.uRain, uFlash: AMBIENT.uFlash, uSnow: AMBIENT.uSnow, uSnowBuild: AMBIENT.uSnowBuild,
      uSkyRefl: sk, uObs: { value: obs }, uObsN: { value: Math.min(12, obstacles.length) },
      uTrack: { value: trackTexture }, uTrackRect: { value: TRACK_RECT },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_FUNCS}`)
      .replace('#include <map_fragment>', GROUND_DIFFUSE)
      .replace('#include <roughnessmap_fragment>', GROUND_ROUGH)
      .replace('#include <emissivemap_fragment>', GROUND_EMISSIVE);
  };
  mat.customProgramCacheKey = () => 'amb-ground';
  return mat;
}

// ───────────────────────────── funnel smoke ─────────────────────────────

const SMOKE_VERT = /* glsl */ `
  attribute vec3 aEmit;
  attribute float aSeed;
  uniform float uTime, uWind;
  uniform vec2 uWindDir;
  varying vec2 vUv;
  varying float vA;
  #include <fog_pars_vertex>
  void main() {
    float t = fract(uTime / 7.0 + aSeed);
    vec3 p = aEmit;
    p.y += t * (4.5 - uWind * 1.2);                                    // rises, flattened by a strong wind
    p.xz += uWindDir * t * t * (1.5 + uWind * 7.0);                    // and bends downwind
    p.x += sin(t * 5.0 + aSeed * 40.0) * 0.35 * t;                      // curling
    p.z += cos(t * 4.0 + aSeed * 23.0) * 0.25 * t;
    float s = 0.45 + t * 2.1;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    float a = aSeed * 17.0 + t * 1.5;                                   // each puff turns slowly
    mvPosition.xy += mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy * s;
    gl_Position = projectionMatrix * mvPosition;
    vUv = uv;
    vA = smoothstep(0.0, 0.07, t) * (1.0 - t) * (1.0 - t);
    #include <fog_vertex>
  }
`;
const SMOKE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vA;
  #include <fog_pars_fragment>
  void main() {
    vec2 q = vUv - 0.5;
    float d = length(q);
    // a lumpy puff: a soft disc with a few bites taken out of its edge
    float lump = 0.06 * sin(atan(q.y, q.x) * 5.0 + vA * 3.0);
    float a = smoothstep(0.5, 0.2, d + lump) * vA * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * (0.85 + 0.3 * (0.5 - q.y)), a);
    #include <fog_fragment>
  }
`;

/** One draw call for every funnel: `emitters` are the funnel tops in world space. */
export function Smoke({ emitters, color, opacity = 0.55, per = 16 }: { emitters: [number, number, number][]; color: string; opacity?: number; per?: number }) {
  const { geo, mat } = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const n = emitters.length * per;
    const emit = new Float32Array(n * 3), seed = new Float32Array(n);
    emitters.forEach((e, k) => {
      for (let i = 0; i < per; i++) {
        const j = k * per + i;
        emit.set(e, j * 3);
        seed[j] = i / per + k * 0.137;
      }
    });
    geo.setAttribute('aEmit', new THREE.InstancedBufferAttribute(emit, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: AMBIENT.uTime, uWind: AMBIENT.uWind, uWindDir: AMBIENT.uWindDir,
        uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    return { geo, mat };
  }, [emitters, color, opacity, per]);
  useLayoutEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={2} />;
}

// ───────────────────────────── dust, leaves, fireflies ─────────────────────────────

const MOTE_VERT = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime, uWind, uNight, uPx, uSize;
  uniform vec2 uWindDir;
  uniform vec3 uBox, uOrigin;
  varying float vA;
  varying float vKind;
  void main() {
    vec3 p = aSeed * uBox;
    float drift = uNight > 0.5 ? 0.15 : (0.35 + uWind * 1.9) * (0.6 + aSeed.y * 0.8);
    p.xz += uWindDir * uTime * drift;
    // wander: fireflies loop about slowly, dust tumbles
    p.x += sin(uTime * (uNight > 0.5 ? 0.45 : 0.8) + aSeed.z * 31.0) * (uNight > 0.5 ? 1.2 : 0.6);
    p.z += cos(uTime * 0.37 + aSeed.x * 27.0) * (uNight > 0.5 ? 1.0 : 0.4);
    p.y += sin(uTime * (uNight > 0.5 ? 0.6 : 1.3) + aSeed.x * 19.0) * (uNight > 0.5 ? 0.5 : 0.35);
    p.x = mod(p.x, uBox.x);
    p.z = mod(p.z, uBox.z);
    p += uOrigin;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vKind = fract(aSeed.z * 7.13);
    float big = uNight > 0.5 ? 1.0 : (vKind < 0.25 ? 1.8 : 1.0);     // a few leaves among the dust
    gl_PointSize = min(uSize * big * uPx * (60.0 / max(1.0, -mvPosition.z)), 14.0 * uPx);   // capped near the menu camera
    // fireflies blink on and off in their own time; dust glints faintly
    float blink = uNight > 0.5 ? smoothstep(0.35, 0.9, sin(uTime * (0.8 + aSeed.y) + aSeed.x * 40.0)) : 0.55 + 0.45 * sin(uTime * 2.0 + aSeed.y * 50.0);
    vA = blink;
  }
`;
const MOTE_FRAG = /* glsl */ `
  uniform vec3 uColor, uLeaf;
  uniform float uNight;
  varying float vA;
  varying float vKind;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d = length(q);
    float a = uNight > 0.5 ? smoothstep(0.5, 0.0, d) : smoothstep(0.5, 0.3, d);
    a *= vA;
    if (a < 0.02) discard;
    vec3 c = uNight < 0.5 && vKind < 0.25 ? uLeaf : uColor;
    gl_FragColor = vec4(c * (uNight > 0.5 ? 1.0 + 1.5 * smoothstep(0.25, 0.0, d) : 1.0), a * (uNight > 0.5 ? 1.0 : 0.7));
  }
`;

/** One draw call of points drifting over the bay (and round the menu's camera). */
export function Motes({ night, amount }: { night: boolean; amount: number }) {
  const { gl } = useThree();
  const n = Math.round((night ? 70 : 150) * amount);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const r = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const rnd = r(night ? 41 : 17);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) seed[i] = rnd();
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // unused, three wants one
    const mat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: {
        uTime: AMBIENT.uTime, uWind: AMBIENT.uWind, uWindDir: AMBIENT.uWindDir,
        uNight: { value: night ? 1 : 0 },
        uPx: { value: gl.getPixelRatio() },
        uSize: { value: night ? 7 : 3.2 },
        uBox: { value: night ? new THREE.Vector3(52, 2.6, 36) : new THREE.Vector3(56, 6, 38) },
        uOrigin: { value: night ? new THREE.Vector3(-26, 0.4, -16) : new THREE.Vector3(-28, 0.3, -17) },
        uColor: { value: new THREE.Color(night ? '#d8ff7c' : '#fff1cf') },
        uLeaf: { value: new THREE.Color('#8fbf4f') },
      },
      transparent: true,
      depthWrite: false,
      blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    return { geo, mat };
  }, [night, n, gl]);
  useLayoutEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  if (n === 0) return null;
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}
