/**
 * Loading the CC0 model packs (public/models, see public/models/CREDITS.md).
 * <Prop> loads a glTF once, clones it per use, casts and receives shadows, and can fit the model into an exact
 * footprint, so a gameplay obstacle keeps the collision box from game/arena.ts whatever model dresses it.
 */
import { useFrame, useLoader } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const MODEL = {
  container: ['watercraft/cargo-container-a.glb', 'watercraft/cargo-container-b.glb', 'watercraft/cargo-container-c.glb'],
  cargoPile: ['watercraft/cargo-pile-a.glb', 'watercraft/cargo-pile-b.glb'],
  tug: 'watercraft/boat-tug-a.glb',
  fishing: 'watercraft/boat-fishing-small.glb',
  cargoShip: 'watercraft/ship-cargo-a.glb',
  sailboat: 'watercraft/boat-sail-a.glb',
  buoy: 'watercraft/buoy.glb',
  buoyFlag: 'watercraft/buoy-flag.glb',
  barrel: 'pirate/Prop_Barrel.gltf',
  fishBucket: 'pirate/Prop_Bucket_Fishes.gltf',
  anchor: 'pirate/Prop_Anchor.gltf',
  dock: 'pirate/Environment_Dock.gltf',
  dockPole: 'pirate/Environment_Dock_Pole.gltf',
  palm1: 'pirate/Environment_PalmTree_1.gltf',
  palm2: 'pirate/Environment_PalmTree_2.gltf',
  rock: 'pirate/Environment_Rock_2.gltf',
  chest: 'pirate/Prop_Chest_Closed.gltf',
  bomb: 'pirate/Prop_Bomb.gltf',
  chestGold: 'pirate/Prop_Chest_Gold.gltf',
  house: ['pirate/Environment_House1.gltf', 'pirate/Environment_House2.gltf', 'pirate/Environment_House3.gltf'],
  palm3: 'pirate/Environment_PalmTree_3.gltf',
  cannon: 'pirate/Prop_Cannon.gltf',
  mackerel: 'pirate/Prop_Fish_Mackerel.gltf',
  crate: 'kpirate/crate.glb',
  crateBottles: 'kpirate/crate-bottles.glb',
  flagPirate: 'kpirate/flag-pirate-high-pennant.glb',
  flagPennant: 'kpirate/flag-high-pennant.glb',
  pirateShip: 'kpirate/ship-pirate-medium.glb',
  pot: 'nature/pot_large.glb',
  potSmall: 'nature/pot_small.glb',
  bush: ['nature/plant_bushDetailed.glb', 'nature/plant_bush.glb', 'nature/plant_bushSmall.glb'],
  grass: ['nature/grass_leafs.glb', 'nature/grass_large.glb'],
  flower: ['nature/flower_yellowA.glb', 'nature/flower_redA.glb', 'nature/flower_purpleA.glb'],
  fish: 'food/fish.glb',
  mussel: 'food/mussel.glb',
  fishBones: 'food/fish-bones.glb',
  sack: 'food/bag.glb',
};

const base = `${import.meta.env.BASE_URL}models/`;
export const modelUrl = (p: string) => base + p;

type V3 = [number, number, number];

/**
 * One model instance.
 * - `fit`: [width, height, depth] in world units. The model is scaled uniformly to fit inside it (height is optional:
 *   pass 0 to ignore), centred on x/z and stood on y = 0. Use it for obstacles, so the footprint stays exact.
 * - `size`: scale uniformly so the model's largest horizontal side is this long (for decoration).
 * - otherwise `scale` is used as given.
 * - `tilt`: roll the model over first (radians about x), e.g. to lay a fish flat.
 */
export function Prop({ src, position = [0, 0, 0], rotation = 0, fit, size, scale = 1, stretch = false, tilt = 0, shadow = true }: {
  src: string; position?: V3; rotation?: number; fit?: V3; size?: number; scale?: number; stretch?: boolean; tilt?: number;
  /** cast a shadow (small clutter doesn't need to: it saves a lot in the shadow pass) */
  shadow?: boolean;
}) {
  const gltf = useLoader(GLTFLoader, modelUrl(src));
  const { object, s, offset } = useMemo(() => {
    const object = gltf.scene.clone(true);
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = shadow; m.receiveShadow = true; }
    });
    object.rotation.order = 'YXZ'; // tilt first, then any quarter turn
    object.rotation.x = tilt;
    // a footprint that is long the other way from the model: turn the model a quarter so its long side follows
    const raw = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    const turn = fit && (raw.x - raw.z) * (fit[0] - fit[2]) < 0;
    if (turn) object.rotation.y = Math.PI / 2;
    const box = new THREE.Box3().setFromObject(object);
    const dim = box.getSize(new THREE.Vector3());
    let s: THREE.Vector3;
    if (fit) {
      if (stretch) s = new THREE.Vector3(fit[0] / dim.x, fit[1] ? fit[1] / dim.y : fit[0] / dim.x, fit[2] / dim.z);
      else {
        const k = Math.min(fit[0] / dim.x, fit[2] / dim.z, fit[1] ? fit[1] / dim.y : Infinity);
        s = new THREE.Vector3(k, k, k);
      }
    } else if (size) {
      const k = size / Math.max(dim.x, dim.z);
      s = new THREE.Vector3(k, k, k);
    } else s = new THREE.Vector3(scale, scale, scale);
    // centre on x/z, feet on the ground
    const c = box.getCenter(new THREE.Vector3());
    const offset = new THREE.Vector3(-c.x * s.x, -box.min.y * s.y, -c.z * s.z);
    return { object, s, offset };
  }, [gltf, fit?.[0], fit?.[1], fit?.[2], size, scale, stretch, tilt, shadow]);

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <group position={offset} scale={s}>
        <primitive object={object} />
      </group>
    </group>
  );
}

// ───────────────────────────── rigged characters ─────────────────────────────

/** Which pirate plays each seat. The ids stay as the game knows them; only the look changes. */
export const RIG: Record<string, string> = {
  frog: 'pirate/Characters_Sharky.gltf',
  cat: 'pirate/Characters_Anne.gltf',
  blob: 'pirate/Characters_Mako.gltf',
  rat: 'pirate/Characters_Henry.gltf',
  duck: 'pirate/Characters_Captain_Barbarossa.gltf',
  creature: 'pirate/Characters_Skeleton.gltf',
};

/** 'pose': one wave hello, then idle (the menu); 'win': wave and nod in turn, each played through to the end. */
export type RigState = 'idle' | 'run' | 'dash' | 'hit' | 'death' | 'win' | 'pose';
/** Written by the creature every frame, read by its rig. */
export interface RigDrive { state: RigState; speed: number; hitAt: number; actAt: number; }
/** A seat's wardrobe: coat in the player's colour, a hat/hair colour of its own, trousers a deeper shade. */
export interface Outfit {
  coat: string; hat: string;
  /** the body is not human skin (a shark): keep the swatch that covers most of the model as it is */
  keepBody?: boolean;
}

/** Characters are scaled to this height (world units), so all six stand the same size. */
const RIG_HEIGHT = 1.9;

// ─── wardrobe: recolour a per-character copy of the 32×32 colour atlas ───

const isSkin = (r: number, g: number, b: number) => r > 150 && r > g && g > b && r - b > 45 && r - b < 140;
const isNeutral = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b) < 18; // greys, whites, blacks

/**
 * Finds which atlas swatches dress which part of the body (by the height of the vertices that sample them), then
 * paints the coat, the hat/hair and the trousers. Skin and neutral details (eyes, belts, bone) are left alone.
 */
export function dress(scene: THREE.Object3D, outfit: Outfit) {
  let tex: THREE.Texture | null = null;
  const meshes: THREE.Mesh[] = [];
  scene.updateWorldMatrix(true, true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { meshes.push(m); tex ??= (m.material as THREE.MeshStandardMaterial).map ?? null; }
  });
  const src = tex as THREE.Texture | null;
  const img = src?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!src || !img || !img.width) return;
  const W = img.width, H = img.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H);

  // per swatch: how many vertices sample it, and their average height
  const stat = new Map<number, { n: number; y: number; lo: number; hi: number }>();
  let lo = Infinity, hi = -Infinity;
  const v = new THREE.Vector3();
  const samples: [number, number][] = [];
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position'), uv = m.geometry.getAttribute('uv');
    if (!pos || !uv) continue;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const x = Math.min(W - 1, Math.max(0, Math.floor(uv.getX(i) * W)));
      const y = Math.min(H - 1, Math.max(0, Math.floor(uv.getY(i) * H)));
      samples.push([y * W + x, v.y]); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
    }
  }
  for (const [k, y] of samples) { const t = stat.get(k) ?? { n: 0, y: 0, lo: y, hi: y }; t.n++; t.y += y; t.lo = Math.min(t.lo, y); t.hi = Math.max(t.hi, y); stat.set(k, t); }
  // a non-human body (the shark's hide): a colour that runs from head to feet is skin, never clothes
  const body = new Set<number>();
  if (outfit.keepBody) for (const [k, t] of stat) if ((t.hi - t.lo) / (hi - lo || 1) > 0.55) body.add(k);
  const pick = (from: number, to: number) => {
    let best = -1, bn = 0;
    for (const [k, t] of stat) {
      if (body.has(k)) continue;
      const h = (t.y / t.n - lo) / (hi - lo || 1);
      const r = px.data[k * 4], gg = px.data[k * 4 + 1], b = px.data[k * 4 + 2];
      if (h < from || h >= to || isSkin(r, gg, b) || isNeutral(r, gg, b) || t.n <= bn) continue;
      best = k; bn = t.n;
    }
    return best;
  };
  const coat = pick(0.42, 0.8), hat = pick(0.8, 1.01), legs = pick(0.0, 0.42);
  const paint = (k: number, hex: string, shade = 1) => {
    if (k < 0) return;
    const c = new THREE.Color(hex).multiplyScalar(shade);
    px.data[k * 4] = Math.round(c.r * 255); px.data[k * 4 + 1] = Math.round(c.g * 255); px.data[k * 4 + 2] = Math.round(c.b * 255);
  };
  paint(coat, outfit.coat); paint(hat, outfit.hat); if (legs !== coat) paint(legs, outfit.coat, 0.55);
  g.putImageData(px, 0, 0);

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace; map.flipY = src.flipY;
  map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.generateMipmaps = false;
  for (const m of meshes) { const mat = (m.material as THREE.MeshStandardMaterial).clone(); mat.map = map; m.material = mat; }
}

export function Rig({ id, drive, outfit }: { id: string; drive: { current: RigDrive }; outfit?: Outfit }) {
  const gltf = useLoader(GLTFLoader, modelUrl(RIG[id] ?? RIG.frog));
  const rig = useMemo(() => {
    const scene = skeletonClone(gltf.scene);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; }
    });
    if (outfit) dress(scene, outfit);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const k = RIG_HEIGHT / Math.max(0.001, box.max.y - box.min.y);
    const mixer = new THREE.AnimationMixer(scene);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
    // a wave that plays once through, for greetings and celebrations (the clip itself loops)
    const wave = gltf.animations.find((c) => c.name === 'Wave');
    if (wave) {
      const once = wave.clone();
      once.name = 'WaveOnce';
      actions.set('WaveOnce', mixer.clipAction(once));
    }
    for (const name of ['HitReact', 'Death', 'Punch', 'Yes', 'WaveOnce']) {
      const a = actions.get(name);
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    const dur = (n: string) => (actions.get(n)?.getClip().duration ?? 1.5) * 1000;
    return { scene, k, minY: box.min.y, mixer, actions, dur, current: '', hitUntil: 0, actUntil: 0, seq: '', seqName: '', seqEnd: 0 };
  }, [gltf, outfit?.coat, outfit?.hat, outfit?.keepBody]);

  useFrame((_, dt) => {
    const d = drive.current;
    const now = performance.now();
    // one-shot reactions sit over whatever the body is doing: a swing when you tag or throw, a flinch when handed the bomb
    if (d.actAt > now - 50) rig.actUntil = now + 380;
    if (d.hitAt > now - 50) rig.hitUntil = now + 420;
    let name: string;
    if (d.state === 'death') name = 'Death';
    else if (d.state === 'win' || d.state === 'pose') {
      // each move plays through to its end before the next starts, so nothing is cut off mid-gesture
      if (rig.seq !== d.state) { rig.seq = d.state; rig.seqName = 'WaveOnce'; rig.seqEnd = now + rig.dur('WaveOnce') - 200; }
      else if (now >= rig.seqEnd) {
        if (d.state === 'pose') { rig.seqName = 'Idle'; rig.seqEnd = Infinity; }
        else { rig.seqName = rig.seqName === 'WaveOnce' ? 'Yes' : 'WaveOnce'; rig.seqEnd = now + rig.dur(rig.seqName) - 200; }
      }
      name = rig.seqName;
    } else if (now < rig.actUntil) name = 'Punch';
    else if (now < rig.hitUntil) name = 'HitReact';
    else if (d.state === 'dash') name = 'Jump';
    else if (d.state === 'run') name = d.speed > 2.4 ? 'Run' : 'Walk';
    else name = 'Idle';
    if (d.state !== 'win' && d.state !== 'pose') rig.seq = '';
    const next = rig.actions.get(name) ?? rig.actions.get('Idle');
    if (next && rig.current !== name) {
      const prev = rig.actions.get(rig.current);
      const fade = name === 'Punch' ? 0.06 : rig.current === 'WaveOnce' || rig.current === 'Yes' ? 0.3 : 0.15;
      next.reset().setEffectiveWeight(1).fadeIn(fade).play();
      if (prev) prev.fadeOut(fade);
      rig.current = name;
    }
    // cadence follows the real speed; a dash leaps quick
    const run = rig.actions.get('Run'), walk = rig.actions.get('Walk'), jump = rig.actions.get('Jump'), punch = rig.actions.get('Punch');
    if (run) run.timeScale = THREE.MathUtils.clamp(d.speed / 5, 0.8, 1.5);
    if (walk) walk.timeScale = THREE.MathUtils.clamp(d.speed / 2, 0.8, 1.4);
    if (jump) jump.timeScale = 1.6;
    if (punch) punch.timeScale = 1.8;
    rig.mixer.update(Math.min(dt, 0.05));
  });

  return (
    <group scale={rig.k} position={[0, -rig.minY * rig.k, 0]}>
      <primitive object={rig.scene} />
    </group>
  );
}
