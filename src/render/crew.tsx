/**
 * The cast: KayKit Adventurers for players, KayKit Skeletons for bots (CC0, Kay Lousberg; see public/models/CREDITS.md).
 * Heroes and skeletons share KayKit's medium rig, so one set of animation clips (KayKit Character Animations, CC0)
 * drives everyone with no retargeting: the clips are matched to bones by name.
 *
 * Driven by a RigDrive ref (state, speed, hitAt, actAt, actKind), like the cast before it.
 */
import { useFrame, useLoader } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterId } from '../game/types';
import { modelUrl, type RigDrive } from './models';

/** Each seat's hero. */
export const HEROES: Record<CharacterId, string> = {
  frog: 'kaykit/Ranger.glb',
  cat: 'kaykit/Barbarian.glb',
  blob: 'kaykit/Mage.glb',
  rat: 'kaykit/Knight.glb',
  duck: 'kaykit/Rogue.glb',
  creature: 'kaykit/Rogue_Hooded.glb',
};
/** Bots are the undead: one of these, by seat. */
export const SKELETONS = ['kaykit/Skeleton_Warrior.glb', 'kaykit/Skeleton_Rogue.glb', 'kaykit/Skeleton_Mage.glb', 'kaykit/Skeleton_Minion.glb'];

/**
 * Each model's build: how tall it stands, its idle, and how quick its stride is. Big and heavy, small and quick,
 * so the silhouettes differ from the high match camera too, not just the colours.
 */
const BUILD: Record<string, { height: number; idle: string; stride: number }> = {
  'kaykit/Barbarian.glb': { height: 2.15, idle: 'Idle_B', stride: 0.88 },
  'kaykit/Knight.glb': { height: 2.05, idle: 'Idle_A', stride: 0.94 },
  'kaykit/Mage.glb': { height: 1.95, idle: 'Idle_B', stride: 1.0 },
  'kaykit/Ranger.glb': { height: 1.95, idle: 'Idle_A', stride: 1.06 },
  'kaykit/Rogue.glb': { height: 1.82, idle: 'Idle_B', stride: 1.14 },
  'kaykit/Rogue_Hooded.glb': { height: 1.85, idle: 'Idle_A', stride: 1.12 },
  'kaykit/Skeleton_Warrior.glb': { height: 2.12, idle: 'Skeletons_Idle', stride: 0.9 },
  'kaykit/Skeleton_Mage.glb': { height: 1.98, idle: 'Skeletons_Idle', stride: 1.0 },
  'kaykit/Skeleton_Rogue.glb': { height: 1.86, idle: 'Skeletons_Idle', stride: 1.12 },
  'kaykit/Skeleton_Minion.glb': { height: 1.68, idle: 'Skeletons_Idle', stride: 1.2 },
};

/**
 * An ink outline: a back-face copy of each mesh pushed out along its (skinned) normals. Our look, not stock KayKit.
 * Width and colour are uniforms, so every figure on the dock shares one compiled program.
 */
function outlineMaterial(width: number, color = '#16110d') {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, toneMapped: false });
  const uWidth = { value: width };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOutlineWidth = uWidth;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlineWidth;')
      .replace(
        '#include <project_vertex>',
        `#ifdef USE_SKINNING
          transformed += normalize(objectNormal) * uOutlineWidth;
        #else
          transformed += normalize(normal) * uOutlineWidth;
        #endif
        #include <project_vertex>`,
      );
  };
  m.customProgramCacheKey = () => 'crew-outline';
  // a fog-free edge: in rain, fog or night the outline is what still says who this is
  m.fog = false;
  return m;
}

/** A skeleton's clothes and armour (separate meshes in KayKit's rigs); bone, eyes and jaw keep their own look. */
const OUTFIT = /(Cloak|Cape|Hood|Hat|Helmet)$/;

/**
 * A figure's material in a player's colour: a soft rim light in that colour round the silhouette (so each figure
 * glows its own identity, even in dark weather), and for a skeleton's clothes a full recolour that keeps the shading
 * (texture brightness drives the shade, hue and saturation come from the player). One material per figure.
 */
function identity(base: THREE.Material, color: string, recolour: boolean): THREE.Material {
  const m = base.clone() as THREE.MeshStandardMaterial;
  const tint = { value: new THREE.Color(color) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = tint;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint;');
    if (recolour)
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // keep the cloth's light and shade (folds, brims, trims) so the shape still reads, and a touch of its detail
        float tl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 dyed = uTint * clamp(0.22 + tl * 3.6, 0.0, 1.2);
        diffuseColor.rgb = mix(dyed, diffuseColor.rgb * 1.6, 0.12);`,
      );
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      totalEmissiveRadiance += uTint * pow(rimF, 3.0) * 0.35;`,
    );
  };
  m.customProgramCacheKey = () => (recolour ? 'crew-id-tint' : 'crew-id');
  return m;
}

/**
 * The game's own bomb, small and unlit, to hang on a hero's hip: black iron, a brass cap, a stub of fuse.
 * Built in world units (radius 0.13), so the caller scales it into the rig's units.
 */
const HIP_IRON = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.35, metalness: 0.4 });
const HIP_CAP = new THREE.MeshStandardMaterial({ color: '#c9973e', roughness: 0.4, metalness: 0.7 });
const HIP_FUSE = new THREE.MeshStandardMaterial({ color: '#c9a46b', roughness: 1 });
function hipBomb(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), HIP_IRON);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.06, 10), HIP_CAP);
  cap.position.y = 0.13;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.09, 5), HIP_FUSE);
  fuse.position.set(0.025, 0.19, 0);
  fuse.rotation.z = -0.5;
  for (const m of [body, cap, fuse]) { m.castShadow = true; g.add(m); }
  return g;
}

const ANIMS = ['general', 'move', 'dodge', 'social', 'melee', 'skeleton', 'select'].map((n) => modelUrl(`kaykit/anim_${n}.glb`));

type Move = 'idle' | 'walk' | 'run' | 'dash' | 'throw' | 'tag' | 'hit' | 'death' | 'win' | 'hello' | 'hold' | 'sit';
const HERO_CLIPS: Record<Move, string> = {
  idle: 'Idle_A', walk: 'Walking_A', run: 'Running_A', dash: 'Dodge_Forward', throw: 'Throw',
  tag: 'Melee_Unarmed_Attack_Punch_A', hit: 'Hit_A', death: 'Death_A', win: 'Cheering', hello: 'Waving',
  hold: 'Holding_A', sit: 'Sit_Floor_Idle', // the title crew: holding the bomb in both hands, sitting on the deck
};
const SKELETON_CLIPS: Record<Move, string> = {
  ...HERO_CLIPS, idle: 'Skeletons_Idle', walk: 'Skeletons_Walking', death: 'Skeletons_Death', win: 'Skeletons_Taunt', hello: 'Skeletons_Taunt',
};
/** Each hero's own move when you pick them in the menu (KayKit Character Animations, CC0), in place of a wave. */
const HERO_SELECT: Record<CharacterId, string> = {
  frog: 'Ranged_Bow_Draw_Up', // Ranger: draws a bow to the sky
  cat: 'Melee_2H_Attack_Spin', // Barbarian: a two-handed spin
  blob: 'Ranged_Magic_Raise', // Mage: a calm raise of the hand
  rat: 'Melee_Block', // Knight: up on guard
  duck: 'Melee_Dualwield_Attack_Stab', // Rogue: quick twin stabs
  creature: 'Melee_Unarmed_Attack_Kick', // Shade: a sharp kick
};
const ONCE: Move[] = ['dash', 'throw', 'tag', 'hit', 'death', 'hello'];

/** Default height (world units) for a model missing from BUILD. */
const HEIGHT = 1.9;

/**
 * One crew member. `bot` swaps the hero for a skeleton; `seat` picks which skeleton.
 * The parent group stands it on the ground facing +z.
 */
export function CrewMember({ id, bot = false, seat = 0, drive, tint }: {
  id: CharacterId; bot?: boolean; seat?: number; drive: { current: RigDrive };
  /** the player's colour: a skeleton's clothes and armour take it (heroes are already painted in their seat's colour) */
  tint?: string;
}) {
  const src = bot ? SKELETONS[seat % SKELETONS.length] : HEROES[id];
  const gltf = useLoader(GLTFLoader, modelUrl(src));
  const anims = useLoader(GLTFLoader, ANIMS);

  const rig = useMemo(() => {
    const scene = skeletonClone(gltf.scene);
    const build = BUILD[src] ?? { height: HEIGHT, idle: bot ? 'Skeletons_Idle' : 'Idle_A', stride: 1 };
    // in a match every figure wears its player's colour: rim light on everything, full recolour on a skeleton's clothes
    const swapped = new Map<THREE.Material, THREE.Material>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
      if (!tint || Array.isArray(m.material)) return;
      const recolour = bot && OUTFIT.test(m.name);
      const key = m.material;
      if (recolour) m.material = identity(key, tint, true);
      else {
        if (!swapped.has(key)) swapped.set(key, identity(key, tint, false));
        m.material = swapped.get(key)!;
      }
    });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const k = build.height / Math.max(0.001, box.max.y - box.min.y);
    // the outline: thin black ink on the menu; in a match a deep ink of the player's own colour. Not the colour itself
    // and not thick: an edge the same colour as the clothes melts the figure into one flat blob from the high camera,
    // and a fat hull pokes through thin hat brims and flickers.
    const ink = tint
      ? outlineMaterial((box.max.y - box.min.y) * 0.0085, '#' + new THREE.Color(tint).multiplyScalar(0.32).getHexString())
      : outlineMaterial((box.max.y - box.min.y) * 0.008);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      const sm = m as THREE.SkinnedMesh;
      let hull: THREE.Mesh;
      if (sm.isSkinnedMesh) {
        const sk = new THREE.SkinnedMesh(sm.geometry, ink);
        sk.bind(sm.skeleton, sm.bindMatrix);
        hull = sk;
      } else hull = new THREE.Mesh(m.geometry, ink);
      hull.position.copy(m.position); hull.quaternion.copy(m.quaternion); hull.scale.copy(m.scale);
      hull.frustumCulled = false;
      m.parent?.add(hull);
    }
    // every hero carries one of the game's own bombs on the hip: on theme, and theirs alone
    if (!bot) {
      const hips = scene.getObjectByName('hips');
      if (hips) {
        const b = hipBomb();
        b.position.set(0.32, 0.04, 0.2); b.rotation.set(0.15, 0.6, -0.25); b.scale.setScalar(1 / k);
        hips.add(b);
      }
    }
    const mixer = new THREE.AnimationMixer(scene);
    const names = { ...(bot ? SKELETON_CLIPS : HERO_CLIPS), idle: build.idle, ...(bot ? {} : { hello: HERO_SELECT[id] ?? HERO_CLIPS.hello }) };
    const all = new Map(anims.flatMap((a) => a.animations).map((c) => [c.name, c]));
    const actions = new Map<Move, THREE.AnimationAction>();
    for (const move of Object.keys(names) as Move[]) {
      const clip = all.get(names[move]);
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      if (ONCE.includes(move)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions.set(move, a);
    }
    const dur = (m: Move) => (actions.get(m)?.getClip().duration ?? 1) * 1000;
    return { scene, k, minY: box.min.y, mixer, actions, dur, stride: build.stride, current: null as Move | null, hitUntil: 0, actUntil: 0, actKind: 'throw' as 'throw' | 'tag', helloUntil: 0, helloOn: false };
  }, [gltf, anims, bot, tint, id]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const d = drive.current, now = performance.now();
    // one-shot reactions: the throw or the tag when you act, a flinch when the bomb lands on you
    if (d.actAt > now - 50) { rig.actKind = d.actKind ?? 'throw'; rig.actUntil = now + rig.dur(rig.actKind) * (rig.actKind === 'throw' ? 0.45 : 0.55); }
    if (d.hitAt > now - 50) rig.hitUntil = now + rig.dur('hit') * 0.7;
    // the menu's hello plays once through, then settles back to idle
    if (d.state === 'pose' && !rig.helloOn) { rig.helloOn = true; rig.helloUntil = now + rig.dur('hello') - 250; }
    if (d.state !== 'pose') rig.helloOn = false;

    let move: Move;
    if (d.state === 'death') move = 'death';
    else if (d.state === 'win') move = 'win';
    else if (d.state === 'pose' && now < rig.helloUntil) move = 'hello';
    else if (now < rig.actUntil) move = rig.actKind;
    else if (now < rig.hitUntil) move = 'hit';
    else if (d.state === 'sit') move = 'sit';
    else if (d.state === 'hold') move = 'hold';
    else if (d.state === 'dash') move = 'dash';
    else if (d.state === 'run') move = d.speed > 2.4 ? 'run' : 'walk';
    else move = 'idle';

    if (move !== rig.current) {
      const next = rig.actions.get(move) ?? rig.actions.get('idle');
      const prev = rig.current ? rig.actions.get(rig.current) : undefined;
      const fade = move === 'throw' || move === 'tag' ? 0.08 : rig.current === 'hello' || rig.current === 'hit' ? 0.3 : 0.18;
      if (next) next.reset().setEffectiveWeight(1).fadeIn(fade).play();
      if (prev && prev !== next) prev.fadeOut(fade);
      rig.current = move;
    }
    // cadence follows the real speed; the one-shots play quick so they read in a fast game
    const run = rig.actions.get('run'), walk = rig.actions.get('walk');
    // each build has its own stride: the heavy ones lumber, the small ones scurry
    if (run) run.timeScale = THREE.MathUtils.clamp(d.speed / 4.6, 0.85, 1.4) * rig.stride;
    if (walk) walk.timeScale = THREE.MathUtils.clamp(d.speed / 1.8, 0.8, 1.4) * rig.stride;
    const idle = rig.actions.get('idle'); if (idle) idle.timeScale = 0.85 + 0.3 * (rig.stride - 0.88) / 0.32;
    for (const m of ['throw', 'tag'] as Move[]) { const a = rig.actions.get(m); if (a) a.timeScale = 2; }
    const dash = rig.actions.get('dash'); if (dash) dash.timeScale = 1.6;
    const hit = rig.actions.get('hit'); if (hit) hit.timeScale = 1.4;
    rig.mixer.update(dt);
  });

  return (
    <group scale={rig.k} position={[0, -rig.minY * rig.k, 0]}>
      <primitive object={rig.scene} />
    </group>
  );
}
