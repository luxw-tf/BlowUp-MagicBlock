/**
 * The live backdrop behind the menus: the dock at a random time of day, and the picked hero centre stage on a
 * pedestal at the harbour edge (they wave as they pop in).
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { LAYOUTS, MOODS, OBSTACLES, WEATHERS, selectLayout, selectMood, selectWeather, weatherFor } from '../game/arena';
import { CHARACTERS } from '../game/content';
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
const CAM = new THREE.Vector3(7.2, 1.95, -4.9);
const LOOK = new THREE.Vector3(7.2, 1.75, -11.2);
/** A proper podium: tall enough that the crew in front (on the title) never covers the hero standing on it. */
const PEDESTAL_H = 0.9;

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
      <mesh position={[0, PEDESTAL_H * 0.55, 0]} rotation={[Math.PI / 2, 0, 0]} material={brass}>
        <torusGeometry args={[1.2, 0.035, 10, 48]} />
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

/** The picked hero on the pedestal: pops in when you switch, waves once. On the title, the title's own hero stands there. */
function Hero({ id: picked }: { id: CharacterId }) {
  const [onTitle, setOnTitle] = useState(titleView.on);
  const id = onTitle ? TITLE_HERO : picked;
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
    if (titleView.on !== onTitle) setOnTitle(titleView.on);
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

/** Set once the harbour has actually been drawn (the title's loading cover waits for it). */
export const stageReady = { drawn: false };

/** Mounted only when everything inside the Suspense has loaded; flags the stage drawn after a couple of frames. */
function DrawnFlag() {
  const frames = useRef(0);
  useFrame(() => {
    if (stageReady.drawn) return;
    if (++frames.current > 3) stageReady.drawn = true;
  });
  return null;
}

/** How much of the title shot is on screen (1 on the title, easing to 0 as the camera glides down to the lobby). */
const titleBlend = { w: 0 };

/**
 * The crew round the pedestal for the title shot (offsets from the stage), symmetric: three each side, in a shallow
 * arc that curves back towards the sea, inside the two dock cannons (at ±6). Every spot stays on the deck side of the harbour railing.
 */
const CREW_SPOTS: { x: number; z: number }[] = [
  { x: -4.9, z: -0.6 },
  { x: -3.6, z: 0.1 },
  { x: -2.3, z: 0.7 },
  { x: 2.3, z: 0.7 },
  { x: 3.6, z: 0.1 },
  { x: 4.9, z: -0.6 },
];
/** Who stands on the title's podium: a different hero each time the page loads. Your own hero takes over as the menu comes in. */
export const TITLE_HERO: CharacterId = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id;

/**
 * The hot potato, as a timeline shared by the crew: who holds it, who's next, when they start the throw, when it
 * leaves their hand. The bomb rides the holder's actual hand bones, so it never floats while they move.
 */
const potato = { holder: 0, next: 1, landedAt: 0, throwStart: 1.2, releaseAt: 1.5 };
/** The throw clip plays at double speed; the bomb leaves the hand about this long after it starts. */
const RELEASE_AFTER = 0.3;
const FLIGHT = 0.7;
/** Each crew member's hand bones (left, right), found once their model has loaded. */
const hands: ([THREE.Object3D, THREE.Object3D] | null)[] = CREW_SPOTS.map(() => null);

/** Where the bomb sits for crew member i: between their hands, or in the right hand once the throw has started. */
function bombAt(i: number, t: number, out: THREE.Vector3) {
  const h = hands[i];
  if (!h) {
    const c = CREW_SPOTS[i];
    return out.set(STAGE.x + c.x, 0.9, STAGE.z + c.z);
  }
  const l = h[0].getWorldPosition(out);
  const r = h[1].getWorldPosition(new THREE.Vector3());
  l.add(r).multiplyScalar(0.5);
  // as the throw starts it slides from between both hands into the throwing hand, over a few frames
  const k = i === potato.holder ? Math.min(1, Math.max(0, (t - potato.throwStart) / 0.15)) : 0;
  return k > 0 ? l.lerp(r, k) : l;
}

/** One of the crew on the title: holds the bomb when it's theirs, turns and throws it on. */
function CrewMate({ id, i, hero }: { id: CharacterId; i: number; hero: CharacterId }) {
  const spot = CREW_SPOTS[i];
  const drive = useRef<RigDrive>({ state: 'idle', speed: 0, hitAt: 0, actAt: 0 });
  const g = useRef<THREE.Group>(null);
  const threwFor = useRef(-1);
  useEffect(() => {
    hands[i] = null; // a different model may stand here now
    return () => {
      hands[i] = null;
    };
  }, [i, id]);
  const px = STAGE.x + spot.x, pz = STAGE.z + spot.z;
  const faceCam = Math.atan2(TITLE_CAM.x - px, TITLE_CAM.z - pz);
  useFrame(({ clock }, dt) => {
    const grp = g.current;
    if (!grp) return;
    // gone a third of the way into the glide down, while the camera is moving; whoever is your hero steps up onto the
    // podium as the title goes, so their double on the deck goes straight away
    grp.visible = titleBlend.w > 0.35 && (titleView.on || id !== hero);
    if (!hands[i]) {
      // three.js strips the dots from node names on load: handslot.l is 'handslotl'
      const l = grp.getObjectByName('handslotl'), r = grp.getObjectByName('handslotr');
      if (l && r) hands[i] = [l, r];
    }
    const t = clock.elapsedTime;
    const mine = potato.holder === i;
    const d = drive.current;
    // the throw itself, once per hand-off
    if (mine && t >= potato.throwStart && threwFor.current !== potato.throwStart) {
      threwFor.current = potato.throwStart;
      d.actKind = 'throw';
      d.actAt = performance.now();
    }
    if (mine && t < potato.releaseAt) d.state = 'hold';
    else d.state = Math.sin(t * 0.7 + spot.x * 1.3) > 0.88 ? 'win' : 'idle';
    // face the camera, but turn to whoever's next for the throw
    let want = faceCam;
    if (mine && t > potato.throwStart - 0.45 && t < potato.releaseAt + 0.3) {
      const n = CREW_SPOTS[potato.next];
      want = Math.atan2(STAGE.x + n.x - px, STAGE.z + n.z - pz);
    }
    let dd = want - grp.rotation.y;
    dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    grp.rotation.y += dd * (1 - Math.exp(-dt * 8));
  });
  return (
    <group ref={g} position={[px, 0, pz]} rotation={[0, faceCam, 0]}>
      <CrewMember id={id} drive={drive} />
    </group>
  );
}

/** The lit bomb: in the holder's hands, then thrown in an arc to the next one's hands (never to the hero). */
function HotPotato() {
  const g = useRef<THREE.Group>(null);
  const spark = useRef<THREE.Mesh>(null);
  const from = useMemo(() => new THREE.Vector3(), []);
  const to = useMemo(() => new THREE.Vector3(), []);
  const released = useRef(false);
  useEffect(() => {
  }, []);
  useFrame(({ clock }) => {
    const b = g.current;
    if (!b) return;
    b.visible = titleBlend.w > 0.35;
    const t = clock.elapsedTime;
    if (t < potato.releaseAt) {
      released.current = false;
      bombAt(potato.holder, t, b.position);
    } else {
      if (!released.current) {
        released.current = true;
        from.copy(b.position); // it leaves from wherever the hand actually was
      }
      const e = Math.min(1, (t - potato.releaseAt) / FLIGHT);
      bombAt(potato.next, t, to); // aim at the catcher's hands as they are now
      const s = e * e * (3 - 2 * e);
      b.position.lerpVectors(from, to, s);
      b.position.y += Math.sin(e * Math.PI) * 1.3;
      b.rotation.x += 0.2;
      if (e >= 1) {
        // caught: the catcher holds it, then picks someone else
        const caught = potato.next;
        let n = caught;
        while (n === caught) n = Math.floor(Math.random() * CREW_SPOTS.length);
        const hold = 0.7 + Math.random() * 0.6;
        potato.holder = caught;
        potato.next = n;
        potato.landedAt = t;
        potato.throwStart = t + hold;
        potato.releaseAt = potato.throwStart + RELEASE_AFTER;
      }
    }
    if (spark.current) spark.current.scale.setScalar(0.6 + Math.random() * 0.7);
  });
  return (
    <group ref={g}>
      <mesh castShadow>
        <sphereGeometry args={[0.2, 18, 14]} />
        <meshStandardMaterial color="#1b1d22" roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.21, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.08, 10]} />
        <meshStandardMaterial color="#c9973e" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh ref={spark} position={[0.05, 0.32, 0]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshBasicMaterial color="#ffd35c" />
      </mesh>
      <pointLight position={[0.05, 0.34, 0]} color="#ffb347" intensity={5} distance={4} decay={2} />
    </group>
  );
}

/** The title's crew: everyone but whoever is on the podium, round the pedestal, passing a lit bomb among themselves. */
function TitleCrew({ hero }: { hero: CharacterId }) {
  const crew = CHARACTERS.filter((c) => c.id !== TITLE_HERO).map((c) => c.id);
  return (
    <>
      {crew.slice(0, CREW_SPOTS.length).map((id, i) => (
        <CrewMate key={id} id={id} i={i} hero={hero} />
      ))}
      <HotPotato />
    </>
  );
}

/** The title camera: low and in front of the crew, drifting slowly side to side; the logo sits in the sky above. */
const TITLE_CAM = new THREE.Vector3(STAGE.x, 3.1, STAGE.z + 11.5);
const TITLE_LOOK = new THREE.Vector3(STAGE.x, 3.4, STAGE.z - 1);

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
    titleBlend.w = fl.w;
    if (fl.w > 0.001) {
      // the title shot: the crew round the pedestal, the camera drifting slowly side to side
      flyPos.set(TITLE_CAM.x + Math.sin(t * 0.12) * 3.2, TITLE_CAM.y + Math.sin(t * 0.17) * 0.3, TITLE_CAM.z + Math.cos(t * 0.12) * 0.8);
      flyLook.copy(TITLE_LOOK);
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
          <TitleCrew hero={hero} />
          <DrawnFlag />
        </Suspense>
      </Canvas>
    </div>
  );
}
