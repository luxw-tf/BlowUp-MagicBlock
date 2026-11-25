/**
 * The live backdrop behind the menus: the dock at a random time of day with the whole crew about the place, each
 * pirate at a spot of their own round the bay. Picking a pirate sweeps the camera round the dock to them (they wave).
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CHARACTERS } from '../game/content';
import { LAYOUTS, MOODS, OBSTACLES, WEATHERS, selectLayout, selectMood, selectWeather, weatherFor } from '../game/arena';
import type { CharacterId } from '../game/types';
import { Arena, lightNow } from './Arena';
import type { RigDrive } from './models';
import { CrewMember } from './crew';

const IDS = CHARACTERS.map((c) => c.id);
/**
 * Each pirate's spot on the dock, in picker order going clockwise round the bay (seen from above): the harbour
 * edge, the right-hand yard, the near quay, the left-hand yard. All are outside the bay, clear of the dressing.
 */
const SPOTS: Record<CharacterId, [number, number]> = {
  frog: [3.2, -11.5], // Ranger, on the harbour edge by the cannons
  cat: [19.4, -5], // Barbarian, by the chest in the right-hand yard
  blob: [12, 11.4], // Mage, on the near quay
  rat: [-1.8, 11.4], // Knight, between the bollards
  duck: [-19.5, 5.2], // Rogue, under the palm
  creature: [-10.2, -11.4], // Shade, by the old anchor
};
/** camera distance from the pirate, eye height, and how far right of centre the pirate sits (the menu is on the left) */
const DIST = 6.4;
const EYE = 1.8;
const SIDE = 1.9;

/** θ = 0 looks north at the harbour; increasing θ turns right (clockwise from above). */
const dir = (a: number) => new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
const polar = (id: CharacterId) => {
  const [x, z] = SPOTS[id];
  return { a: Math.atan2(x, -z), r: Math.hypot(x, z) };
};
const camFor = (id: CharacterId) => {
  const { a, r } = polar(id);
  return dir(a).multiplyScalar(r - DIST).setY(EYE);
};

function Pirate({ id, active }: { id: CharacterId; active: boolean }) {
  const drive = useRef<RigDrive>({ state: 'idle', speed: 0, hitAt: 0, actAt: 0 });
  const [x, z] = SPOTS[id];
  const cam = camFor(id);
  useEffect(() => {
    if (!active) return;
    // one wave hello as the camera comes round to them, then back to idle (the rig plays it through)
    const t = setTimeout(() => (drive.current.state = 'pose'), 450);
    return () => {
      clearTimeout(t);
      drive.current.state = 'idle';
    };
  }, [active]);
  return (
    <group position={[x, 0, z]} rotation={[0, Math.atan2(cam.x - x, cam.z - z), 0]}>
      <CrewMember id={id} drive={drive} />
    </group>
  );
}

/**
 * While the title card is up the camera flies a slow, wide circle round the whole harbour instead (the title screen
 * sets this); when it goes, the camera glides down to the picked hero.
 */
export const titleView = { on: false };

/**
 * The camera lives in polar coordinates round the middle of the bay and eases its angle and distance towards the
 * picked pirate, so moving between them sweeps round the dock (always the short way) instead of cutting across it.
 */
function Orbit({ hero }: { hero: CharacterId }) {
  const { camera } = useThree();
  const cur = useRef(polar(hero));
  const look = useMemo(() => new THREE.Vector3(), []);
  // title fly-around: how much of it is in the shot (0..1), and where it has got to
  const fly = useRef({ w: titleView.on ? 1 : 0, a: 0.5 });
  const flyPos = useMemo(() => new THREE.Vector3(), []);
  const flyLook = useMemo(() => new THREE.Vector3(), []);
  const key = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  // a key light that travels with the camera, so the picked pirate's face always reads (stronger after dark)
  const L = lightNow();
  const keyI = L.sunI < 1 ? 95 : L.lamps ? 55 : 32;
  useFrame(({ clock }, dt) => {
    const g = polar(hero);
    let goal = g.a;
    goal += Math.round((cur.current.a - goal) / (Math.PI * 2)) * Math.PI * 2;
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * 2.4);
    cur.current.a += (goal - cur.current.a) * k;
    cur.current.r += (g.r - cur.current.r) * k;
    const t = clock.elapsedTime;
    const a = cur.current.a + Math.sin(t * 0.15) * 0.02; // a slow breath while you decide
    const f = dir(a);
    const right = new THREE.Vector3(-f.z, 0, f.x);
    camera.position.copy(f).multiplyScalar(cur.current.r - DIST).setY(EYE + Math.sin(t * 0.2) * 0.05);
    look.copy(f).multiplyScalar(cur.current.r).addScaledVector(right, -SIDE).setY(1.45);
    // the title's fly-around: a slow, high circle round the harbour, looking in over the bay and out to sea
    const fl = fly.current;
    fl.w += ((titleView.on ? 1 : 0) - fl.w) * (1 - Math.exp(-Math.min(dt, 0.05) * (titleView.on ? 6 : 1.4)));
    if (fl.w > 0.001) {
      fl.a += Math.min(dt, 0.05) * 0.045;
      const fa = fl.a;
      flyPos.set(Math.sin(fa) * 30, 9.5 + Math.sin(t * 0.13) * 1.2, -6 + Math.cos(fa) * 26);
      flyLook.set(Math.sin(fa + 2.2) * 6, 1.5, -9 + Math.cos(fa + 2.2) * 5);
      const w = fl.w * fl.w * (3 - 2 * fl.w); // smoothstep, so the glide down to the hero eases in and out
      camera.position.lerp(flyPos, w);
      look.lerp(flyLook, w);
    }
    camera.lookAt(look);
    if (key.current) {
      key.current.position.copy(camera.position).addScaledVector(right, 1.6).setY(EYE + 2.2);
      target.position.copy(f).multiplyScalar(cur.current.r).setY(1.1);
      target.updateMatrixWorld();
    }
  });
  return (
    <>
      <primitive object={target} />
      <spotLight ref={key} target={target} intensity={keyI} color="#fff1dc" angle={0.42} penumbra={0.8} distance={22} decay={1.6} />
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
    const pinned = MOODS.indexOf(q.get('mood') as (typeof MOODS)[number]); // ?mood=night
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
        camera={{ fov: 40, near: 0.3, far: 400, position: camFor(hero).toArray() }}
      >
        <color attach="background" args={[L.sky]} />
        <fog attach="fog" args={[L.sky, L.fogNear, L.fogFar]} />
        <Exposure />
        <Orbit hero={hero} />
        <Suspense fallback={null}>
          <Arena key={mood} shadows town />
          {IDS.map((id) => (
            <Pirate key={id} id={id} active={id === hero} />
          ))}
        </Suspense>
      </Canvas>
    </div>
  );
}
