/**
 * Headshots of the crew, rendered once from the real 3D models into small transparent PNGs, for the places a 3D
 * scene can't go: the results podium, lobby slots, the name chip. Heroes are keyed by character, the bots'
 * skeletons by 'skel0'..'skel3'. Rendering happens off-screen on first use; until then callers show a colour disc.
 */
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTERS } from '../game/content';
import type { CharacterId } from '../game/types';
import { HEROES, SKELETONS, dyeBotBones } from './crew';
import { modelUrl } from './models';

export type PortraitKey = CharacterId | `skel${number}`;
export const portraitKey = (character: CharacterId, bot: boolean, seat: number): PortraitKey => (bot ? `skel${seat % SKELETONS.length}` : character);

const SIZE = 192;
const shots = new Map<PortraitKey, string>();
const listeners = new Set<() => void>();
let started = false;

async function renderAll() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const loader = new GLTFLoader();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 50);
  const idle = (await loader.loadAsync(modelUrl('kaykit/anim_general.glb'))).animations.find((a) => a.name === 'Idle_A');
  const jobs: [PortraitKey, string][] = [
    ...CHARACTERS.map((c) => [c.id, HEROES[c.id]] as [PortraitKey, string]),
    ...SKELETONS.map((src, i) => [`skel${i}`, src] as [PortraitKey, string]),
  ];
  for (const [key, src] of jobs) {
    try {
      const gltf = await loader.loadAsync(modelUrl(src));
      const model = skeletonClone(gltf.scene);
      if (key.startsWith('skel')) dyeBotBones(model);
      if (idle) {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(idle).play();
        mixer.update(0.5);
      }
      const scene = new THREE.Scene();
      scene.add(model);
      scene.add(new THREE.HemisphereLight('#fff6e6', '#5a4a3a', 1.7));
      const keyLight = new THREE.DirectionalLight('#ffffff', 2.4);
      keyLight.position.set(1.5, 2.5, 3);
      scene.add(keyLight);
      // frame the head: KayKit heads are big, so the top ~45% of the figure
      model.updateMatrixWorld(true);
      const head = model.getObjectByName('head');
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y;
      const c = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, box.max.y - h * 0.25, 0);
      const look = new THREE.Vector3(c.x, c.y + h * 0.12, c.z);
      camera.position.set(look.x + h * 0.1, look.y + h * 0.04, look.z + h * 1.55);
      camera.lookAt(look);
      renderer.render(scene, camera);
      shots.set(key, renderer.domElement.toDataURL('image/png'));
      listeners.forEach((f) => f());
    } catch {
      /* no portrait for this one: the colour disc stays */
    }
  }
  renderer.dispose();
  renderer.forceContextLoss();
}

/** The headshot as a data URL, or undefined while it is still being rendered. */
export function usePortrait(key: PortraitKey): string | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    if (!started) {
      started = true;
      void renderAll();
    }
    return () => void listeners.delete(f);
  }, []);
  return shots.get(key);
}
