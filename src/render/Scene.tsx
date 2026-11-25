import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ARENA } from '../game/arena';
import { CONFIG, TICK_DT } from '../game/config';
import { ABILITY_DEFS, characterDef } from '../game/content';
import { fuseRemaining, getPlayer, holderCanAct } from '../game/sim';
import { getSettings, useSettings } from '../state/settings';
import { Arena, lightNow } from './Arena';
import { currentLayout, currentMood, currentWeather } from '../game/arena';
import { Creature } from './Creature';
import { MODEL, Prop } from './models';
import { overlay, useGame } from './context';

const ELEVATION = (54 * Math.PI) / 180;
/** Vertical field of view: narrow-ish, so the dock has real depth without fish-eye stretching at the edges. */
const FOV = 30;
/** World-space vertical extent kept on screen: full arena depth + headroom. */
const VIEW_HEIGHT = ARENA.halfDepth * 2 * Math.sin(ELEVATION) + 7.5;
/** Camera distance that fits VIEW_HEIGHT at the look-at point with a perspective camera. */
const CAM_DIST = VIEW_HEIGHT / 2 / Math.tan((FOV * Math.PI) / 360);

// ───────────────────────────── camera ─────────────────────────────

function CameraRig() {
  const { camera, size } = useThree();
  const { session, input, focus, renderPos, shake } = useGame();
  const state = useRef({ x: 0, bob: 0, z: -2.6, zoom: 0 });
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== FOV) { cam.fov = FOV; }
    cam.aspect = size.width / size.height;
    // Perspective: the visible half-width at the look-at distance (PRD: horizontal tracking only).
    const halfW = CAM_DIST * Math.tan((FOV * Math.PI) / 360) * cam.aspect;

    const f = renderPos.get(focus.id) ?? getPlayer(session.state, focus.id)?.pos ?? { x: 0, z: 0 };
    const st = state.current;
    // spectating: glide in on whoever you're following (both axes), or stay wide in overview
    const me = getPlayer(session.state, session.localId);
    const spectating = !!me && !me.alive && session.state.phase !== 'finished' && !focus.overview;
    st.zoom += ((spectating ? 1 : 0) - st.zoom) * (1 - Math.exp(-3 * dt));
    const dead = Math.min(2.2, halfW * 0.18) * (1 - st.zoom);
    let goal = st.x;
    if (f.x > st.x + dead) goal = f.x - dead;
    if (f.x < st.x - dead) goal = f.x + dead;
    const margin = 1.6;
    const viewHalfW = halfW * (1 - 0.45 * st.zoom);
    const maxX = Math.max(0, ARENA.halfWidth + margin - viewHalfW);
    goal = THREE.MathUtils.clamp(goal, -maxX, maxX);
    st.x += (goal - st.x) * (1 - Math.exp(-5 * dt));
    const zGoal = THREE.MathUtils.lerp(-2.6, THREE.MathUtils.clamp(f.z, -ARENA.halfDepth + 2, ARENA.halfDepth - 2), st.zoom);
    st.z += (zGoal - st.z) * (1 - Math.exp(-5 * dt));

    shake.amount = Math.max(0, shake.amount - dt * 2.5);
    const sMul = getSettings().reducedShake ? 0.2 : 1;
    const sh = shake.amount * shake.amount * sMul;
    const ox = (Math.random() - 0.5) * sh * 0.8;
    const oy = (Math.random() - 0.5) * sh * 0.8;
    // a slow, tiny drift so the harbour never looks frozen (kept well under a degree)
    const drift = getSettings().reducedShake ? 0 : Math.sin(clock.elapsedTime * 0.25) * 0.18;

    // normally aim a little toward the sea, so the quay and harbour show along the top; spectating aims at the player
    const tz = st.z;
    const dist = CAM_DIST * (1 - 0.45 * st.zoom);
    cam.position.set(st.x + ox + drift, Math.sin(ELEVATION) * dist + oy, tz + Math.cos(ELEVATION) * dist);
    cam.lookAt(st.x + ox, oy, tz);
    cam.updateProjectionMatrix();

    // Aim: mouse ray onto the ground plane.
    ndc.set(input.pointer.x, input.pointer.y);
    ray.setFromCamera(ndc, cam);
    if (ray.ray.intersectPlane(plane, hit)) input.aimWorld = { x: hit.x, z: hit.z };
  }, -1);

  return null;
}

// ───────────────────────────── overlay projection ─────────────────────────────

function OverlayProjector() {
  const { camera, size } = useThree();
  const { session, renderPos } = useGame();
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const s = session.state;
    for (const p of s.players) {
      const el = overlay.tags.get(p.id);
      if (!el) continue;
      const rp = renderPos.get(p.id);
      if (!p.alive || !rp) {
        el.style.display = 'none';
        continue;
      }
      v.set(rp.x, s.bomb.holderId === p.id && !s.bomb.projectile ? 2.75 : 2.15, rp.z).project(camera);
      el.style.display = 'block';
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }

    // Off-screen bomb holder indicator.
    const ind = overlay.indicator;
    if (!ind) return;
    const holder = getPlayer(s, s.bomb.holderId);
    const hp = holder && renderPos.get(holder.id);
    if (!holder || !hp || holder.id === session.localId) {
      ind.style.display = 'none';
      return;
    }
    v.set(hp.x, 0.8, hp.z).project(camera);
    const sx = ((v.x + 1) / 2) * size.width;
    const sy = ((1 - v.y) / 2) * size.height;
    const pad = 46;
    if (sx >= 0 && sx <= size.width && sy >= 0 && sy <= size.height) {
      ind.style.display = 'none';
      return;
    }
    const cx = THREE.MathUtils.clamp(sx, pad, size.width - pad);
    const cy = THREE.MathUtils.clamp(sy, pad + 60, size.height - pad);
    const ang = Math.atan2(sy - cy, sx - cx);
    ind.style.display = 'flex';
    ind.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    const arrow = ind.firstElementChild as HTMLElement | null;
    if (arrow) arrow.style.transform = `rotate(${ang}rad)`;
  });
  return null;
}

// ───────────────────────────── bomb ─────────────────────────────

function Bomb() {
  const { session, renderPos } = useGame();
  const group = useRef<THREE.Group>(null);
  const shell = useRef<THREE.MeshStandardMaterial>(null);
  const spark = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const pos = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    const s = session.state;
    const g = group.current;
    if (!g || !shell.current || !ring.current || !ringMat.current) return;
    const holder = getPlayer(s, s.bomb.holderId);
    const proj = s.bomb.projectile;
    if (!holder || s.phase !== 'active') {
      g.visible = false;
      ring.current.visible = false;
      return;
    }
    g.visible = true;
    const hp = renderPos.get(holder.id) ?? holder.pos;

    if (proj) {
      const ahead = Math.min(session.alpha, 1) * CONFIG.throwSpeed * TICK_DT;
      const x = proj.pos.x + proj.dir.x * ahead;
      const z = proj.pos.z + proj.dir.z * ahead;
      const t = Math.min(1, (proj.traveled + ahead) / CONFIG.throwRange);
      pos.current.set(x, 0.75 + Math.sin(t * Math.PI) * 0.9, z);
      g.position.copy(pos.current);
      g.rotation.x += dt * 18;
    } else {
      const target = new THREE.Vector3(hp.x, 2.2, hp.z);
      // Snap on transfer, otherwise follow tightly.
      if (g.position.distanceTo(target) > 2.5) g.position.copy(target);
      else g.position.lerp(target, 1 - Math.exp(-30 * dt));
      g.rotation.x *= 0.9;
    }

    const fuse = fuseRemaining(s);
    const now = performance.now() / 1000;
    let glow = 0;
    if (fuse === null) {
      // Arming: awaiting randomness for the new fuse.
      g.rotation.y += dt * 12;
      glow = 0.6 + Math.sin(now * 30) * 0.4;
      shell.current.emissive.set('#ffffff');
    } else {
      const rate = fuse < 1 ? 14 : fuse < 2 ? 9 : fuse < 4 ? 4 : 2;
      glow = fuse < 4 ? (Math.sin(now * rate * Math.PI) * 0.5 + 0.5) * (1 - fuse / 4) * 2.2 : 0;
      shell.current.emissive.set('#ff2a1a');
    }
    shell.current.emissiveIntensity = glow;
    const sc = 1 + (fuse !== null && fuse < 2 ? Math.sin(now * 40) * 0.06 : 0);
    g.scale.setScalar(sc);
    if (spark.current) spark.current.scale.setScalar(0.7 + Math.random() * 0.6);

    // Holder ring on the ground.
    ring.current.visible = true;
    ring.current.position.set(hp.x, 0.04, hp.z);
    ring.current.rotation.z += dt * 2;
    ringMat.current.opacity = 0.55 + Math.sin(now * 8) * 0.25;
  });

  return (
    <>
      <group ref={group}>
        <mesh castShadow>
          <sphereGeometry args={[0.3, 20, 16]} />
          <meshStandardMaterial ref={shell} color="#1b1d22" roughness={0.35} metalness={0.4} emissive="#ff2a1a" emissiveIntensity={0} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.07, 0.09, 0.12, 10]} />
          <meshStandardMaterial color="#555" metalness={0.6} />
        </mesh>
        <mesh position={[0.06, 0.42, 0]} rotation={[0, 0, -0.5]}>
          <cylinderGeometry args={[0.02, 0.02, 0.18, 5]} />
          <meshStandardMaterial color="#c9a46b" />
        </mesh>
        <mesh ref={spark} position={[0.12, 0.52, 0]}>
          <sphereGeometry args={[0.07, 8, 6]} />
          <meshBasicMaterial color="#ffd35c" />
        </mesh>
      </group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.62, 0.78, 32, 1, 0, Math.PI * 1.7]} />
        <meshBasicMaterial ref={ringMat} color="#ff3b2f" transparent depthWrite={false} />
      </mesh>
    </>
  );
}

/** Throw line + tag radius for the local holder. */
function AimGuide() {
  const { session, input, renderPos } = useGame();
  const line = useRef<THREE.Mesh>(null);
  const tagRing = useRef<THREE.Mesh>(null);
  const settings = useSettings();

  useFrame(() => {
    const s = session.state;
    const me = getPlayer(s, session.localId);
    const show = !!me && settings.aimGuide && holderCanAct(s, me);
    if (!line.current || !tagRing.current) return;
    line.current.visible = show;
    tagRing.current.visible = show;
    if (!show || !me) return;
    const p = renderPos.get(me.id) ?? me.pos;
    const dx = input.aimWorld.x - p.x;
    const dz = input.aimWorld.z - p.z;
    const ang = Math.atan2(dx, dz);
    const L = CONFIG.throwRange;
    line.current.position.set(p.x + Math.sin(ang) * L * 0.5, 0.05, p.z + Math.cos(ang) * L * 0.5);
    line.current.rotation.set(-Math.PI / 2, 0, ang);
    tagRing.current.position.set(p.x, 0.05, p.z);
  });

  return (
    <>
      <mesh ref={line} visible={false}>
        <planeGeometry args={[0.12, CONFIG.throwRange]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh ref={tagRing} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[CONFIG.tagRange - 0.04, CONFIG.tagRange, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </>
  );
}

// ───────────────────────────── pickups ─────────────────────────────

/** An item pickup: a small open chest of gold that bobs, turns slowly and glints. */
function PickupBox({ index }: { index: number }) {
  const { session } = useGame();
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const glint = useRef<THREE.Mesh>(null);
  const spawnT = useRef(1);
  const spot = session.state.pickups[index];

  useFrame((_, dt) => {
    const sp = session.state.pickups[index];
    if (!g.current) return;
    const on = sp.available;
    if (ring.current) ring.current.visible = on;
    if (!on) {
      g.current.visible = false;
      spawnT.current = 0;
      return;
    }
    g.current.visible = true;
    spawnT.current = Math.min(1, spawnT.current + dt * 3);
    const e = spawnT.current;
    const pop = e < 1 ? 1 + Math.sin(e * Math.PI) * 0.35 : 1;
    const t = performance.now() * 0.001;
    g.current.scale.setScalar(e * pop);
    g.current.rotation.y += dt * 0.7;
    g.current.position.y = 0.12 + Math.sin(t * 2.4 + index) * 0.07;
    if (ring.current) {
      const k = (t * 0.8 + index * 0.3) % 1;
      ring.current.scale.setScalar(0.7 + k * 0.6);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.6;
    }
    if (glint.current) {
      // a star glint that pops every couple of seconds
      const p = (t * 0.45 + index * 0.37) % 1;
      const s = p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0;
      glint.current.scale.setScalar(s * 0.5 + 0.0001);
      glint.current.rotation.z = t * 2;
    }
  });

  return (
    <group position={[spot.pos.x, 0, spot.pos.z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.62, 0.72, 40]} />
        <meshBasicMaterial color="#ffd35c" transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <group ref={g}>
        <Suspense fallback={null}>
          <Prop src={MODEL.chestGold} size={1.15} rotation={0.4} shadow={false} />
        </Suspense>
        <mesh ref={glint} position={[0.18, 0.85, 0.2]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={GLINT} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** A four-pointed star for the chest's glint, drawn once. */
const GLINT = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.25, 'rgba(255,230,150,0.6)');
  grad.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, r = i % 2 ? 6 : 32;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// ───────────────────────────── particles ─────────────────────────────

interface Particle {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grav: number;
  color: THREE.Color;
}

interface Ring {
  alive: boolean;
  x: number;
  z: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

/** One cartoon explosion: flash, fireball puffs, smoke, tumbling debris, a shockwave and a scorch mark. */
interface Blast { alive: boolean; x: number; z: number; t: number; color: string; seed: number[] }
const BLAST_LIFE = 1.6;
const SCORCH_LIFE = 6;
const PUFFS = 8, SMOKE = 6, DEBRIS = 12;
const fireRamp = [new THREE.Color('#fff4c2'), new THREE.Color('#ffc23d'), new THREE.Color('#ff6a2a'), new THREE.Color('#9c3b26'), new THREE.Color('#4a3f3c')];
const tmpColor = new THREE.Color();
function ramp(k: number) {
  const f = Math.min(0.999, Math.max(0, k)) * (fireRamp.length - 1), i = Math.floor(f);
  return tmpColor.copy(fireRamp[i]).lerp(fireRamp[i + 1], f - i);
}

function BlastView({ b }: { b: Blast }) {
  const root = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const puffs = useRef<(THREE.Mesh | null)[]>([]);
  const smoke = useRef<(THREE.Mesh | null)[]>([]);
  const debris = useRef<(THREE.Mesh | null)[]>([]);
  const wave = useRef<THREE.Mesh>(null);
  const scorch = useRef<THREE.Mesh>(null);
  const deb = useMemo(() => Array.from({ length: DEBRIS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3() })), []);
  const started = useRef(-1);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = root.current;
    if (!g) return;
    if (!b.alive) { g.visible = false; started.current = -1; return; }
    g.visible = true;
    g.position.set(b.x, 0, b.z);
    if (started.current !== b.seed[0]) {
      // a new blast: throw the debris
      started.current = b.seed[0];
      deb.forEach((d, i) => {
        const a = (i / DEBRIS) * Math.PI * 2 + b.seed[i % b.seed.length] * 0.6;
        const sp = 4 + b.seed[(i + 3) % b.seed.length] * 5;
        d.p.set(0, 0.7, 0);
        d.v.set(Math.cos(a) * sp, 5 + b.seed[(i + 5) % b.seed.length] * 5, Math.sin(a) * sp);
        d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        d.w.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      });
    }
    b.t += dt;
    const t = b.t;
    if (t > SCORCH_LIFE) { b.alive = false; return; }
    const live = t < BLAST_LIFE;

    // the flash: a fast white-hot pop
    if (flash.current) {
      const k = Math.min(1, t / 0.12);
      flash.current.visible = t < 0.28;
      flash.current.scale.setScalar(0.4 + k * 2.1);
      (flash.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t / 0.28);
    }
    // fireball puffs: bloom out and up, burn from yellow through orange to soot, then shrink away
    puffs.current.forEach((m, i) => {
      if (!m) return;
      m.visible = live && t < 0.95;
      if (!m.visible) return;
      const a = (i / PUFFS) * Math.PI * 2 + b.seed[i % b.seed.length];
      const out = Math.min(1, t / 0.35);
      const reach = 0.7 + b.seed[(i + 2) % b.seed.length] * 0.9;
      m.position.set(Math.cos(a) * reach * out, 0.7 + out * (0.4 + (i % 3) * 0.35) + t * 0.6, Math.sin(a) * reach * out);
      const grow = Math.sin(Math.min(1, t / 0.95) * Math.PI);
      m.scale.setScalar((0.55 + b.seed[(i + 4) % b.seed.length] * 0.5) * (0.35 + grow));
      m.rotation.set(t * 2 + i, t * 1.4, 0);
      (m.material as THREE.MeshStandardMaterial).color.copy(ramp(t / 0.95));
      (m.material as THREE.MeshStandardMaterial).emissive.copy(ramp(t / 0.95)).multiplyScalar(Math.max(0, 0.6 - t));
    });
    // smoke: rolls up slowly and thins out
    smoke.current.forEach((m, i) => {
      if (!m) return;
      const t0 = 0.18 + i * 0.05, k = (t - t0) / (BLAST_LIFE - t0);
      m.visible = live && k > 0 && k < 1;
      if (!m.visible) return;
      const a = (i / SMOKE) * Math.PI * 2 + 0.5;
      m.position.set(Math.cos(a) * 0.6 * (1 + k), 1.2 + k * 2.6, Math.sin(a) * 0.6 * (1 + k));
      m.scale.setScalar(0.5 + k * 1.1);
      m.rotation.y = t * 0.8 + i;
      (m.material as THREE.MeshStandardMaterial).opacity = 0.85 * (1 - k);
    });
    // debris: tumbles, bounces once, then settles and sinks
    debris.current.forEach((m, i) => {
      if (!m) return;
      const d = deb[i];
      m.visible = t < 2.4;
      if (!m.visible) return;
      d.v.y -= 22 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < 0.08) { d.p.y = 0.08; d.v.y = Math.abs(d.v.y) * 0.3; d.v.x *= 0.55; d.v.z *= 0.55; d.w.multiplyScalar(0.5); }
      d.r.addScaledVector(d.w, dt);
      m.position.copy(d.p);
      m.rotation.set(d.r.x, d.r.y, d.r.z);
      m.scale.setScalar(t > 1.8 ? Math.max(0.001, 1 - (t - 1.8) / 0.6) : 1);
    });
    // shockwave on the ground
    if (wave.current) {
      const k = t / 0.5;
      wave.current.visible = k < 1;
      wave.current.scale.setScalar(0.5 + k * 5.5);
      (wave.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
    }
    // scorch mark: stays a few seconds, then fades
    if (scorch.current) {
      (scorch.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, t / 0.15) * (1 - Math.max(0, (t - SCORCH_LIFE + 2) / 2));
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={flash}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#fff8dc" transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh key={`p${i}`} ref={(el) => (puffs.current[i] = el)} castShadow>
          <icosahedronGeometry args={[0.85, 1]} />
          <meshStandardMaterial flatShading roughness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: SMOKE }, (_, i) => (
        <mesh key={`s${i}`} ref={(el) => (smoke.current[i] = el)}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#8d8a88" flatShading roughness={1} transparent depthWrite={false} />
        </mesh>
      ))}
      {Array.from({ length: DEBRIS }, (_, i) => (
        <mesh key={`d${i}`} ref={(el) => (debris.current[i] = el)} castShadow>
          <boxGeometry args={[i % 3 ? 0.22 : 0.34, 0.12, i % 2 ? 0.16 : 0.3]} />
          <meshStandardMaterial color={i % 3 === 0 ? b.color : i % 3 === 1 ? '#c99257' : '#3d3f46'} roughness={0.7} />
        </mesh>
      ))}
      <mesh ref={wave} position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.78, 1, 40]} />
        <meshBasicMaterial color="#fff3d6" transparent depthWrite={false} />
      </mesh>
      <mesh ref={scorch} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.5, 24]} />
        <meshBasicMaterial color="#1e1a18" transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

const MAX_BLASTS = 6;

const MAX_PARTICLES = 600;
const MAX_RINGS = 12;

function Effects() {
  const { session, renderPos, shake } = useGame();
  const inst = useRef<THREE.InstancedMesh>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const parts = useMemo<Particle[]>(
    () =>
      Array.from({ length: MAX_PARTICLES }, () => ({
        alive: false,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        life: 0,
        max: 1,
        size: 0.1,
        grav: 0,
        color: new THREE.Color(),
      })),
    [],
  );
  const rings = useMemo<Ring[]>(
    () => Array.from({ length: MAX_RINGS }, () => ({ alive: false, x: 0, z: 0, life: 0, max: 1, size: 1, color: '#fff' })),
    [],
  );
  const blasts = useMemo<Blast[]>(() => Array.from({ length: MAX_BLASTS }, () => ({ alive: false, x: 0, z: 0, t: 0, color: '#fff', seed: [] as number[] })), []);
  const cursor = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const dustTimer = useRef(new Map<string, number>());

  const spawn = (x: number, y: number, z: number, n: number, o: { speed: number; up: number; life: number; size: number; grav: number; colors: string[] }) => {
    const reduced = getSettings().reducedEffects;
    const count = reduced ? Math.ceil(n * 0.35) : n;
    for (let i = 0; i < count; i++) {
      const pt = parts[cursor.current];
      cursor.current = (cursor.current + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const sp = o.speed * (0.4 + Math.random() * 0.6);
      pt.alive = true;
      pt.p.set(x, y, z);
      pt.v.set(Math.cos(a) * sp, o.up * (0.5 + Math.random() * 0.8), Math.sin(a) * sp);
      pt.life = 0;
      pt.max = o.life * (0.6 + Math.random() * 0.6);
      pt.size = o.size * (0.6 + Math.random() * 0.8);
      pt.grav = o.grav;
      pt.color.set(o.colors[Math.floor(Math.random() * o.colors.length)]);
    }
  };
  const ring = (x: number, z: number, size: number, color: string, max = 0.45) => {
    const r = rings.find((q) => !q.alive) ?? rings[0];
    Object.assign(r, { alive: true, x, z, life: 0, max, size, color });
  };
  const at = (id: string) => renderPos.get(id) ?? getPlayer(session.state, id)?.pos ?? { x: 0, z: 0 };

  useEffect(
    () =>
      session.subscribe((events) => {
        for (const e of events) {
          switch (e.type) {
            case 'elimination': {
              const b = blasts.find((q) => !q.alive) ?? blasts[0];
              const who = getPlayer(session.state, e.id);
              Object.assign(b, { alive: true, x: e.at.x, z: e.at.z, t: 0, color: who ? characterDef(who.character).color : '#ffd23f', seed: Array.from({ length: 8 }, () => Math.random()) });
              shake.amount = Math.min(1.2, shake.amount + 1);
              break;
            }
            case 'transfer': {
              const p = at(e.to);
              spawn(p.x, 1.2, p.z, 18, { speed: 5, up: 3, life: 0.4, size: 0.14, grav: 10, colors: ['#ffffff', '#ffd35c'] });
              ring(p.x, p.z, e.method === 'reflect' ? 3 : 2.2, e.method === 'reflect' ? '#ff5fa2' : '#ffffff');
              shake.amount = Math.min(1.2, shake.amount + 0.25);
              break;
            }
            case 'miss':
              spawn(e.at.x, 0.4, e.at.z, 14, { speed: 3, up: 2, life: 0.5, size: 0.18, grav: 6, colors: ['#bbb', '#999'] });
              break;
            case 'blocked': {
              const p = at(e.by);
              ring(p.x, p.z, 2.5, '#4fc3ff');
              spawn(p.x, 0.8, p.z, 16, { speed: 4, up: 2, life: 0.4, size: 0.14, grav: 4, colors: ['#4fc3ff', '#ffffff'] });
              break;
            }
            case 'dash': {
              const p = at(e.id);
              spawn(p.x, 0.2, p.z, e.emergency ? 24 : 12, { speed: 2.5, up: 1, life: 0.45, size: 0.22, grav: 0, colors: e.emergency ? ['#7dff6b', '#e0ffe0'] : ['#e8e2d6', '#cfc8ba'] });
              break;
            }
            case 'pickupCollected': {
              const sp = session.state.pickups[e.spot].pos;
              spawn(sp.x, 0.6, sp.z, 20, { speed: 3, up: 4, life: 0.6, size: 0.12, grav: 6, colors: ['#ffd35c', '#8a5cff', '#ffffff'] });
              break;
            }
            case 'abilityUsed': {
              const p = at(e.id);
              ring(p.x, p.z, 1.8, ABILITY_DEFS[e.ability].color);
              if (e.target) {
                const t = at(e.target);
                ring(t.x, t.z, 1.6, ABILITY_DEFS[e.ability].color);
              }
              break;
            }
            case 'swap': {
              for (const id of [e.a, e.b]) {
                const p = getPlayer(session.state, id)!.pos;
                spawn(p.x, 0.7, p.z, 16, { speed: 2, up: 3, life: 0.5, size: 0.15, grav: 2, colors: ['#c38bff', '#ffffff'] });
              }
              break;
            }
          }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = session.state;

    // Footstep dust for moving players.
    for (const p of s.players) {
      if (!p.alive) continue;
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (sp < 3) continue;
      const t = (dustTimer.current.get(p.id) ?? 0) - dt;
      if (t <= 0) {
        const rp = renderPos.get(p.id) ?? p.pos;
        spawn(rp.x, 0.08, rp.z, 1, { speed: 0.4, up: 0.6, life: 0.4, size: 0.16, grav: 0, colors: ['#d8d2c4'] });
        dustTimer.current.set(p.id, 0.12);
      } else dustTimer.current.set(p.id, t);
    }

    const m = inst.current;
    if (m) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const pt = parts[i];
        if (pt.alive) {
          pt.life += dt;
          if (pt.life >= pt.max) pt.alive = false;
          pt.v.y -= pt.grav * dt;
          pt.v.multiplyScalar(1 - dt * 1.5);
          pt.p.addScaledVector(pt.v, dt);
          if (pt.p.y < 0.05) {
            pt.p.y = 0.05;
            pt.v.y *= -0.3;
          }
        }
        const k = pt.alive ? 1 - pt.life / pt.max : 0;
        dummy.position.copy(pt.p);
        dummy.scale.setScalar(pt.size * k + 1e-4);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, pt.color);
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    rings.forEach((r, i) => {
      const mesh = ringRefs.current[i];
      if (!mesh) return;
      if (!r.alive) {
        mesh.visible = false;
        return;
      }
      r.life += dt;
      if (r.life >= r.max) r.alive = false;
      const k = r.life / r.max;
      mesh.visible = r.alive;
      mesh.position.set(r.x, 0.06, r.z);
      mesh.scale.setScalar(0.2 + k * r.size);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(r.color);
      mat.opacity = (1 - k) * 0.8;
    });
  });

  return (
    <>
      <instancedMesh ref={inst} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial flatShading roughness={0.8} />
      </instancedMesh>
      {blasts.map((b, i) => (
        <BlastView key={i} b={b} />
      ))}
      {rings.map((_, i) => (
        <mesh key={i} ref={(el) => (ringRefs.current[i] = el)} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.85, 1, 40]} />
          <meshBasicMaterial transparent depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

// ───────────────────────────── root ─────────────────────────────

export function Scene() {
  const { session } = useGame();
  const settings = useSettings();
  const L = lightNow();
  const { gl } = useThree();
  useEffect(() => { gl.toneMappingExposure = L.exposure; }, [gl, L.exposure]);
  // ?perf: expose the renderer and scene for frame-time checks in the console
  const { scene } = useThree();
  useEffect(() => {
    if (new URLSearchParams(location.search).has('perf')) Object.assign(window, { __gl: gl, __scene: scene });
  }, [gl, scene]);

  // Drive the simulation from the render loop (fixed-step inside).
  useFrame((_, dt) => session.update(dt), -2);

  return (
    <>
      <color attach="background" args={[L.sky]} />
      <fog attach="fog" args={[L.sky, L.fogNear, L.fogFar]} />
      <CameraRig />
      <Arena key={`${currentLayout().id}-${currentMood()}-${currentWeather()}`} shadows={settings.shadows} />
      {session.state.players.map((p) => (
        <Creature key={p.id} id={p.id} />
      ))}
      {session.state.pickups.map((_, i) => (
        <PickupBox key={i} index={i} />
      ))}
      <Bomb />
      <AimGuide />
      <Effects />
      <OverlayProjector />
    </>
  );
}
