/**
 * Loading the CC0 model packs (public/models, see public/models/CREDITS.md).
 * <Prop> loads a glTF once, clones it per use, casts and receives shadows, and can fit the model into an exact
 * footprint, so a gameplay obstacle keeps the collision box from game/arena.ts whatever model dresses it.
 */
import { useLoader } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

// ───────────────────────────── the crew (see crew.tsx) ─────────────────────────────

/** 'pose': one wave hello, then idle (the menu); 'win': the victory cheer (heroes) or taunt (skeletons). */
export type RigState = 'idle' | 'run' | 'dash' | 'hit' | 'death' | 'win' | 'pose';
/** Written by the creature every frame, read by its rig. */
export interface RigDrive { state: RigState; speed: number; hitAt: number; actAt: number; /** what the last action was */ actKind?: 'throw' | 'tag'; }
