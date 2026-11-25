/**
 * Headshots of the six pirates, rendered once from the real 3D models (dressed in their seat colours) into small
 * transparent PNGs, for the places a 3D scene can't go: the results podium, lobby slots, the name chip.
 * Rendering happens off-screen on first use; until a portrait is ready, callers show a plain colour disc.
 */
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTERS } from '../game/content';
import type { CharacterId } from '../game/types';
import { OUTFIT } from './Creature';
import { RIG, dress, modelUrl } from './models';

const SIZE = 192;
const shots = new Map<CharacterId, string>();
const listeners = new Set<() => void>();
let started = false;

async function renderAll() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const loader = new GLTFLoader();
  const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 50);

  for (const c of CHARACTERS) {
    try {
      const gltf = await loader.loadAsync(modelUrl(RIG[c.id]));
      const model = skeletonClone(gltf.scene);
      dress(model, OUTFIT[c.id]);
      // a relaxed pose: a moment into the idle loop rather than the bind pose
      const idle = gltf.animations.find((a) => a.name === 'Idle');
      if (idle) {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(idle).play();
        mixer.update(0.4);
      }
      const scene = new THREE.Scene();
      scene.add(model);
      scene.add(new THREE.HemisphereLight('#fff6e6', '#6b5a48', 1.6));
      const key = new THREE.DirectionalLight('#ffffff', 2.4);
      key.position.set(1.5, 2.5, 3);
      scene.add(key);
      const rim = new THREE.DirectionalLight('#bfe4ff', 1.4);
      rim.position.set(-2, 1.5, -2);
      scene.add(rim);
      // frame head and shoulders
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y;
      const head = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - h * 0.2, (box.min.z + box.max.z) / 2);
      camera.position.set(head.x + h * 0.08, head.y + h * 0.04, head.z + h * 1.45);
      camera.lookAt(head.x, head.y - h * 0.02, head.z);
      renderer.render(scene, camera);
      shots.set(c.id, renderer.domElement.toDataURL('image/png'));
      listeners.forEach((f) => f());
    } catch {
      /* no portrait for this one: the colour disc stays */
    }
  }
  renderer.dispose();
  renderer.forceContextLoss();
}

/** The pirate's headshot as a data URL, or undefined while it is still being rendered. */
export function usePortrait(id: CharacterId): string | undefined {
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
  return shots.get(id);
}
