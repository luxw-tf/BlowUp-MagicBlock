/**
 * The live backdrop behind the menus: the dock at a random time of day, and the picked hero centre stage on a
 * pedestal at the harbour edge (they wave as they pop in).
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LAYOUTS, MOODS, OBSTACLES, WEATHERS, selectLayout, selectMood, selectWeather, weatherFor } from '../game/arena';
import type { CharacterId } from '../game/types';
import { Arena, lightNow } from './Arena';
import type { RigDrive } from './models';
import { CrewMember } from './crew';

/**
 * The lobby: one fixed, composed shot. The picked hero stands centre stage on a wooden pedestal at the harbour
 * edge, looking back at the camera, with the sea, boats and sky behind (not whatever part of the dock they idle in).
 */
const STAGE = new THREE.Vector3(7.2, 0, -11.2);
/** the camera: a little below head height and back, looking slightly up so the hero stands tall */
const CAM = new THREE.Vector3(7.2, 1.5, -4.9);
const LOOK = new THREE.Vector3(7.2, 1.3, -11.2);
const PEDESTAL_H = 0.42;

/** A round timber pedestal: planked top, a brass rim, a coil of rope round the foot. */
function Pedestal() {
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a5530', roughness: 0.85 }), []);
  const side = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b3d1f', roughness: 0.9 }), []);
  const brass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.8, roughness: 0.3 }), []);
  const rope = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9a26b', roughness: 1 }), []);
  return (
    <group position={[STAGE.x, 0, STAGE.z]}>
      <mesh position={[0, PEDESTAL_H / 2, 0]} castShadow receiveShadow material={side}>
        <cylinderGeometry args={[1.15, 1.25, PEDESTAL_H, 40]} />
      </mesh>
      <mesh position={[0, PEDESTAL_H + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={wood}>
        <circleGeometry args={[1.12, 40]} />
      </mesh>
      <mesh position={[0, PEDESTAL_H - 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} material={brass}>
        <torusGeometry args={[1.14, 0.045, 10, 48]} />
      </mesh>
      {[0.06, 0.15].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={rope}>
          <torusGeometry args={[1.3, 0.055, 8, 48]} />
        </mesh>
      ))}
    </group>
  );
}

/** Which way the last switch went (the menu sets it): the next hero spins in from that side. */
export const heroTurn = { dir: 1 };

/** The picked hero on the pedestal: pops in when you switch, waves once. */
function Hero({ id }: { id: CharacterId }) {
  const drive = useRef<RigDrive>({ state: 'idle', speed: 0, hitAt: 0, actAt: 0 });
  const g = useRef<THREE.Group>(null);
  const born = useRef(performance.now());
  const spin = useRef(heroTurn.dir);
  useEffect(() => {
    born.current = performance.now();
    spin.current = heroTurn.dir;
    const t = setTimeout(() => (drive.current.state = 'pose'), 350);
    return () => {
      clearTimeout(t);
      drive.current.state = 'idle';
    };
  }, [id]);
  useFrame(() => {
    if (!g.current) return;
    const k = Math.min(1, (performance.now() - born.current) / 380);
    const e = 1 - Math.pow(1 - k, 3);
    const s = 1.15 * (0.6 + 0.4 * e + Math.sin(e * Math.PI) * 0.12);
    g.current.scale.setScalar(s);
    g.current.rotation.y = Math.atan2(CAM.x - STAGE.x, CAM.z - STAGE.z) + (1 - e) * 2.4 * spin.current;
  });
  return (
    <group ref={g} position={[STAGE.x, PEDESTAL_H, STAGE.z]}>
      <CrewMember key={id} id={id} drive={drive} />
    </group>
  );
}

/**
 * While the title card is up the camera flies a slow, wide circle round the whole harbour instead (the title screen
 * sets this); when it goes, the camera glides down to the picked hero.
 */
export const titleView = { on: false };

/** The lobby camera: fixed on the stage (a slow breath), or flying the title circle while the title card is up. */
function Orbit() {
  const { camera } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  const fly = useRef({ w: titleView.on ? 1 : 0, a: 0.5 });
  const flyPos = useMemo(() => new THREE.Vector3(), []);
  const flyLook = useMemo(() => new THREE.Vector3(), []);
  const key = useRef<THREE.SpotLight>(null);
  const rim = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const L = lightNow();
  const keyI = L.sunI < 1 ? 100 : L.lamps ? 60 : 34; // scaled by time of day, like the old key light
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    camera.position.set(CAM.x + Math.sin(t * 0.15) * 0.08, CAM.y + Math.sin(t * 0.2) * 0.03, CAM.z);
    look.copy(LOOK);
    const fl = fly.current;
    fl.w += ((titleView.on ? 1 : 0) - fl.w) * (1 - Math.exp(-Math.min(dt, 0.05) * (titleView.on ? 6 : 1.4)));
    if (fl.w > 0.001) {
      fl.a += Math.min(dt, 0.05) * 0.045;
      const fa = fl.a;
      flyPos.set(Math.sin(fa) * 30, 9.5 + Math.sin(t * 0.13) * 1.2, -6 + Math.cos(fa) * 26);
      flyLook.set(Math.sin(fa + 2.2) * 6, 1.5, -9 + Math.cos(fa + 2.2) * 5);
      const w = fl.w * fl.w * (3 - 2 * fl.w);
      camera.position.lerp(flyPos, w);
      look.lerp(flyLook, w);
    }
    camera.lookAt(look);
    target.position.set(STAGE.x, 1.2, STAGE.z);
    target.updateMatrixWorld();
  });
  return (
    <>
      <primitive object={target} />
      {/* a spotlight on the hero from above the camera, and a warm rim from behind so they lift off the sea */}
      <spotLight ref={key} target={target} position={[CAM.x + 1.2, 6, CAM.z + 1]} intensity={keyI} color="#fff1dc" angle={0.36} penumbra={0.7} distance={24} decay={1.4} castShadow />
      <spotLight ref={rim} target={target} position={[STAGE.x - 2, 4.5, STAGE.z - 3.5]} intensity={keyI * 0.6} color="#ffc27a" angle={0.5} penumbra={0.9} distance={14} decay={1.5} />
    </>
  );
}

function Exposure() {
  const { gl } = useThree();
  const L = lightNow();
  useEffect(() => {
    gl.toneMappingExposure = L.exposure;
  }, [gl, L.exposure]);
  return null;
}

export function MenuStage({ hero }: { hero: CharacterId }) {
  // a fresh time of day each visit; the bay is cleared so the camera's sweep never clips a container
  const mood = useMemo(() => {
    selectLayout(Math.floor(Math.random() * LAYOUTS.length));
    OBSTACLES.splice(0, OBSTACLES.length); // a match picks its own layout again when it starts
    const q = new URLSearchParams(location.search);
    const pinned = MOODS.indexOf((q.get('mood') ?? q.get('weather')) as (typeof MOODS)[number]); // ?mood=night (or ?weather=night)
    let mood = selectMood(pinned >= 0 ? pinned : Math.floor(Math.random() * MOODS.length));
    // and weather to go with it (?weather=fog); a storm brings the night with it unless the mood is pinned
    const pw = WEATHERS.find((w) => w === q.get('weather'));
    if (pw === 'storm' && pinned < 0) mood = selectMood(MOODS.indexOf('night'));
    return `${mood}-${selectWeather(pw ?? weatherFor(mood, Math.floor(Math.random() * 1e9)))}`;
  }, []);
  const L = lightNow();

  return (
    <div className="menu-stage" aria-hidden>
      <Canvas
        shadows="soft"
        dpr={[1, 1.25]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        camera={{ fov: 38, near: 0.3, far: 400, position: CAM.toArray() }}
      >
        <color attach="background" args={[L.sky]} />
        <fog attach="fog" args={[L.sky, L.fogNear, L.fogFar]} />
        <Exposure />
        <Orbit />
        <Suspense fallback={null}>
          <Arena key={mood} shadows town />
          <Pedestal />
          <Hero id={hero} />
        </Suspense>
      </Canvas>
    </div>
  );
}
