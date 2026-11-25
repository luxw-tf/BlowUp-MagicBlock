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

/** An ink outline: a back-face copy of each mesh pushed out along its (skinned) normals. Our look, not stock KayKit. */
function outlineMaterial(width: number) {
  const m = new THREE.MeshBasicMaterial({ color: '#16110d', side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      '#include <project_vertex>',
      `#ifdef USE_SKINNING
        transformed += normalize(objectNormal) * ${width.toFixed(5)};
      #else
        transformed += normalize(normal) * ${width.toFixed(5)};
      #endif
      #include <project_vertex>`,
    );
  };
  m.customProgramCacheKey = () => `outline-${width.toFixed(5)}`;
  return m;
}

const BOMB_URL = modelUrl('kaykit/props/smokebomb.gltf');

const ANIMS = ['general', 'move', 'dodge', 'social', 'melee', 'skeleton'].map((n) => modelUrl(`kaykit/anim_${n}.glb`));

type Move = 'idle' | 'walk' | 'run' | 'dash' | 'throw' | 'tag' | 'hit' | 'death' | 'win' | 'hello';
const HERO_CLIPS: Record<Move, string> = {
  idle: 'Idle_A', walk: 'Walking_A', run: 'Running_A', dash: 'Dodge_Forward', throw: 'Throw',
  tag: 'Melee_Unarmed_Attack_Punch_A', hit: 'Hit_A', death: 'Death_A', win: 'Cheering', hello: 'Waving',
};
const SKELETON_CLIPS: Record<Move, string> = {
  ...HERO_CLIPS, idle: 'Skeletons_Idle', walk: 'Skeletons_Walking', death: 'Skeletons_Death', win: 'Skeletons_Taunt', hello: 'Skeletons_Taunt',
};
const ONCE: Move[] = ['dash', 'throw', 'tag', 'hit', 'death', 'hello'];

/** Characters are scaled to this height (world units), so the whole cast stands the same size. */
const HEIGHT = 1.9;

/**
 * One crew member. `bot` swaps the hero for a skeleton; `seat` picks which skeleton.
 * The parent group stands it on the ground facing +z.
 */
export function CrewMember({ id, bot = false, seat = 0, drive }: { id: CharacterId; bot?: boolean; seat?: number; drive: { current: RigDrive } }) {
  const src = bot ? SKELETONS[seat % SKELETONS.length] : HEROES[id];
  const gltf = useLoader(GLTFLoader, modelUrl(src));
  const anims = useLoader(GLTFLoader, ANIMS);
  const bomb = useLoader(GLTFLoader, BOMB_URL);

  const rig = useMemo(() => {
    const scene = skeletonClone(gltf.scene);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; }
    });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const k = HEIGHT / Math.max(0.001, box.max.y - box.min.y);
    // the ink outline, about 1% of the figure's height
    const ink = outlineMaterial((box.max.y - box.min.y) * 0.008);
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
    // every hero carries a smoke bomb on the hip: on theme, and theirs alone
    if (!bot) {
      const hips = scene.getObjectByName('hips');
      if (hips) {
        const b = bomb.scene.clone(true);
        b.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) mm.castShadow = true; });
        b.position.set(0.32, 0.04, 0.2); b.rotation.set(0.25, 0.6, -0.3); b.scale.setScalar(1.25);
        hips.add(b);
      }
    }
    const mixer = new THREE.AnimationMixer(scene);
    const names = bot ? SKELETON_CLIPS : HERO_CLIPS;
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
    return { scene, k, minY: box.min.y, mixer, actions, dur, current: null as Move | null, hitUntil: 0, actUntil: 0, actKind: 'throw' as 'throw' | 'tag', helloUntil: 0, helloOn: false };
  }, [gltf, anims, bomb, bot]);

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
    if (run) run.timeScale = THREE.MathUtils.clamp(d.speed / 4.6, 0.85, 1.4);
    if (walk) walk.timeScale = THREE.MathUtils.clamp(d.speed / 1.8, 0.8, 1.4);
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
