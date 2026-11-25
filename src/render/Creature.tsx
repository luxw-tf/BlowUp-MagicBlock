/**
 * Placeholder creature models + procedural animation (idle, run, dash,
 * receive bomb, panic, elimination launch, victory). Distinct silhouettes and
 * colours per character, identical gameplay. Replaced by GLB rigs in Phase 04.
 */
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
import type { RigDrive } from './models';
import { CrewMember } from './crew';
import * as THREE from 'three';
import { characterDef } from '../game/content';
import { fuseRemaining } from '../game/sim';
import type { CharacterId, PlayerId } from '../game/types';
import { useGame } from './context';

function Eye({ x, y, z, r = 0.1, glow }: { x: number; y: number; z: number; r?: number; glow?: string }) {
  if (glow) {
    return (
      <mesh position={[x, y, z]}>
        <sphereGeometry args={[r, 10, 8]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={2} />
      </mesh>
    );
  }
  return (
    <group position={[x, y, z]}>
      <mesh>
        <sphereGeometry args={[r, 12, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, r * 0.75]}>
        <sphereGeometry args={[r * 0.45, 10, 8]} />
        <meshStandardMaterial color="#111" roughness={0.2} />
      </mesh>
    </group>
  );
}

function Model({ id }: { id: CharacterId }) {
  const c = characterDef(id);
  const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => (
    <meshStandardMaterial color={color} roughness={0.55} {...extra} />
  );
  switch (id) {
    case 'frog':
      return (
        <group>
          <mesh castShadow position={[0, 0.38, 0]} scale={[1.05, 0.72, 1]}>
            <sphereGeometry args={[0.48, 20, 16]} />
            {mat(c.color)}
          </mesh>
          <mesh position={[0, 0.3, 0.2]} scale={[0.8, 0.55, 0.6]}>
            <sphereGeometry args={[0.45, 16, 12]} />
            {mat(c.accent)}
          </mesh>
          {[-0.2, 0.2].map((x) => (
            <group key={x}>
              <mesh castShadow position={[x, 0.66, 0.12]}>
                <sphereGeometry args={[0.15, 14, 10]} />
                {mat(c.color)}
              </mesh>
              <Eye x={x} y={0.7} z={0.2} r={0.11} />
            </group>
          ))}
          {[-0.3, 0.3].map((x) => (
            <mesh key={`f${x}`} position={[x, 0.06, 0.25]} scale={[1.4, 0.4, 1.2]}>
              <sphereGeometry args={[0.12, 10, 8]} />
              {mat(c.color)}
            </mesh>
          ))}
        </group>
      );
    case 'cat':
      return (
        <group>
          <mesh castShadow position={[0, 0.42, 0]} scale={[0.9, 0.85, 1.05]}>
            <sphereGeometry args={[0.42, 18, 14]} />
            {mat(c.color)}
          </mesh>
          <mesh castShadow position={[0, 0.88, 0.08]}>
            <sphereGeometry args={[0.32, 18, 14]} />
            {mat(c.color)}
          </mesh>
          <mesh position={[0, 0.82, 0.3]} scale={[1, 0.7, 0.6]}>
            <sphereGeometry args={[0.16, 12, 10]} />
            {mat(c.accent)}
          </mesh>
          {[-0.17, 0.17].map((x) => (
            <mesh key={x} castShadow position={[x, 1.18, 0.05]} rotation={[0, 0, x > 0 ? -0.3 : 0.3]}>
              <coneGeometry args={[0.11, 0.24, 4]} />
              {mat(c.color)}
            </mesh>
          ))}
          <Eye x={-0.12} y={0.95} z={0.27} r={0.075} />
          <Eye x={0.12} y={0.95} z={0.27} r={0.075} />
          <mesh castShadow position={[0, 0.65, -0.48]} rotation={[-0.9, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 0.65, 8]} />
            {mat(c.color)}
          </mesh>
        </group>
      );
    case 'blob':
      return (
        <group>
          <mesh castShadow position={[0, 0.45, 0]} scale={[1.05, 0.9, 1.05]}>
            <sphereGeometry args={[0.5, 24, 18]} />
            {mat(c.color, { transparent: true, opacity: 0.88, roughness: 0.15, emissive: c.color, emissiveIntensity: 0.15 })}
          </mesh>
          <mesh position={[0, 0.42, 0]} scale={0.5}>
            <sphereGeometry args={[0.5, 12, 10]} />
            {mat(c.accent, { transparent: true, opacity: 0.5 })}
          </mesh>
          <Eye x={-0.16} y={0.6} z={0.38} r={0.1} />
          <Eye x={0.16} y={0.6} z={0.38} r={0.1} />
        </group>
      );
    case 'rat':
      return (
        <group>
          <mesh castShadow position={[0, 0.4, 0]} scale={[0.8, 0.75, 1.25]}>
            <sphereGeometry args={[0.42, 18, 14]} />
            {mat(c.color)}
          </mesh>
          <mesh castShadow position={[0, 0.55, 0.42]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.22, 0.45, 14]} />
            {mat(c.color)}
          </mesh>
          <mesh position={[0, 0.55, 0.67]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            {mat(c.accent)}
          </mesh>
          {[-0.2, 0.2].map((x) => (
            <mesh key={x} castShadow position={[x, 0.82, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.15, 0.15, 0.04, 16]} />
              {mat(c.accent)}
            </mesh>
          ))}
          <Eye x={-0.1} y={0.68} z={0.45} r={0.06} />
          <Eye x={0.1} y={0.68} z={0.45} r={0.06} />
          <mesh position={[0, 0.25, -0.75]} rotation={[-1.3, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.04, 0.7, 6]} />
            {mat(c.accent)}
          </mesh>
        </group>
      );
    case 'duck':
      return (
        <group>
          <mesh castShadow position={[0, 0.38, -0.05]} scale={[0.95, 0.8, 1.15]}>
            <sphereGeometry args={[0.44, 18, 14]} />
            {mat(c.color)}
          </mesh>
          <mesh castShadow position={[0, 0.86, 0.12]}>
            <sphereGeometry args={[0.28, 18, 14]} />
            {mat(c.color)}
          </mesh>
          <mesh castShadow position={[0, 0.8, 0.42]} scale={[1, 0.35, 1]}>
            <sphereGeometry args={[0.17, 12, 10]} />
            {mat(c.accent)}
          </mesh>
          <Eye x={-0.12} y={0.95} z={0.3} r={0.065} />
          <Eye x={0.12} y={0.95} z={0.3} r={0.065} />
          <mesh position={[0, 0.5, -0.5]} rotation={[0.7, 0, 0]}>
            <coneGeometry args={[0.15, 0.3, 8]} />
            {mat(c.color)}
          </mesh>
        </group>
      );
    case 'creature':
      return (
        <group>
          <mesh castShadow position={[0, 0.62, 0]}>
            <cylinderGeometry args={[0.3, 0.38, 1.0, 16]} />
            {mat(c.color, { roughness: 0.8 })}
          </mesh>
          <mesh castShadow position={[0, 1.12, 0]}>
            <sphereGeometry args={[0.3, 16, 12]} />
            {mat(c.color, { roughness: 0.8 })}
          </mesh>
          {[-0.16, 0.16].map((x) => (
            <mesh key={x} castShadow position={[x, 1.42, 0]} rotation={[0, 0, x > 0 ? -0.35 : 0.35]}>
              <coneGeometry args={[0.06, 0.3, 6]} />
              {mat('#1a2230')}
            </mesh>
          ))}
          <Eye x={-0.11} y={1.15} z={0.26} r={0.06} glow={c.accent} />
          <Eye x={0.11} y={1.15} z={0.26} r={0.06} glow={c.accent} />
          {[-0.36, 0.36].map((x) => (
            <mesh key={`a${x}`} castShadow position={[x, 0.55, 0]} rotation={[0, 0, x > 0 ? 0.25 : -0.25]}>
              <cylinderGeometry args={[0.05, 0.05, 0.7, 6]} />
              {mat(c.color)}
            </mesh>
          ))}
        </group>
      );
  }
}

/** Each seat's wardrobe: the coat takes the seat's colour (as in the HUD), the hat or hair a colour of its own. */

export function Creature({ id }: { id: PlayerId }) {
  const { session, renderPos, focus } = useGame();
  const marker = useRef<THREE.Mesh>(null);
  const player = session.state.players.find((p) => p.id === id)!;
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const shield = useRef<THREE.Mesh>(null);
  const shieldMat = useRef<THREE.MeshStandardMaterial>(null);
  const slowRing = useRef<THREE.Mesh>(null);
  const anim = useRef({ yaw: 0, phase: 0, pop: 0, launchT: -1, lastPos: { ...player.pos }, smooth: { ...player.pos } });
  /** what the rigged model should be doing, set every frame below */
  const drive = useRef<RigDrive>({ state: 'idle', speed: 0, hitAt: 0, actAt: 0 });
  const ring = characterDef(player.character).color;
  const seat = session.state.players.findIndex((p) => p.id === id);

  useEffect(
    () =>
      session.subscribe((events) => {
        for (const e of events) {
          if ((e.type === 'transfer' && e.to === id) || (e.type === 'holderAssigned' && e.holder === id)) { anim.current.pop = 1; drive.current.hitAt = performance.now(); }
          // the tagger or thrower swings
          if (e.type === 'throw' && e.from === id) { drive.current.actAt = performance.now(); drive.current.actKind = 'throw'; }
          if (e.type === 'transfer' && e.from === id && e.method === 'tag') { drive.current.actAt = performance.now(); drive.current.actKind = 'tag'; }
          if (e.type === 'elimination' && e.id === id) anim.current.launchT = 0;
          if (e.type === 'swap' && (e.a === id || e.b === id)) {
            const p = session.state.players.find((q) => q.id === id)!;
            anim.current.smooth = { ...p.pos };
            anim.current.lastPos = { ...p.pos };
          }
        }
      }),
    [session, id],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = session.state;
    if (marker.current) {
      const me = s.players.find((q) => q.id === session.localId);
      const on = !!me && !me.alive && s.phase !== 'finished' && focus.id === id && !focus.overview;
      marker.current.visible = on;
      if (on) marker.current.scale.setScalar(1 + Math.sin(performance.now() * 0.006) * 0.08);
    }
    const p = s.players.find((q) => q.id === id)!;
    const a = anim.current;
    if (!root.current || !body.current) return;

    if (!p.alive) {
      drive.current.state = 'death';
      // Elimination launch: up and away with a spin, then gone.
      if (a.launchT < 0) {
        root.current.visible = false;
        return;
      }
      a.launchT += dt;
      const t = a.launchT;
      // knocked back in a short hop while the Death animation plays, then sinks into the smoke
      root.current.position.y = Math.max(0, 4.2 * t - 7 * t * t);
      if (t < 0.6) root.current.position.z -= dt * 2.4;
      root.current.scale.setScalar(t < 1.1 ? 1 : Math.max(0.001, 1 - (t - 1.1) / 0.5));
      if (t > 1.6) {
        a.launchT = -1;
        root.current.visible = false;
      }
      return;
    }
    root.current.visible = true;

    // Position: authoritative render position with a short smoothing filter.
    const target = session.renderPos(id);
    const k = 1 - Math.exp(-(id === session.localId ? 35 : 25) * dt);
    if (Math.hypot(target.x - a.smooth.x, target.z - a.smooth.z) > 3) a.smooth = { ...target };
    a.smooth.x += (target.x - a.smooth.x) * k;
    a.smooth.z += (target.z - a.smooth.z) * k;
    renderPos.set(id, { ...a.smooth });

    const vx = (a.smooth.x - a.lastPos.x) / Math.max(dt, 1e-3);
    const vz = (a.smooth.z - a.lastPos.z) / Math.max(dt, 1e-3);
    a.lastPos = { ...a.smooth };
    const speed = Math.hypot(vx, vz);

    root.current.position.set(a.smooth.x, 0, a.smooth.z);

    // Facing: holders face their aim, everyone else faces movement.
    const isHolder = s.bomb.holderId === id;
    let yawTarget = a.yaw;
    if (isHolder && (p.aim.x !== 0 || p.aim.z !== 0)) yawTarget = Math.atan2(p.aim.x - a.smooth.x, p.aim.z - a.smooth.z);
    else if (speed > 0.6) yawTarget = Math.atan2(vx, vz);
    let dy = yawTarget - a.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    a.yaw += dy * (1 - Math.exp(-16 * dt));
    root.current.rotation.y = a.yaw;

    // Body animation.
    const dashing = s.time < p.dashUntil;
    const moving = Math.min(1, speed / 6);
    a.phase += dt * (6 + speed * 2.2);
    const bob = Math.abs(Math.sin(a.phase)) * 0.12 * moving;
    a.pop = Math.max(0, a.pop - dt * 3.5);
    const pop = Math.sin(a.pop * Math.PI) * 0.35;

    let sx = 1 + pop * 0.6;
    let sy = 1 - pop * 0.5;
    let sz = 1;
    if (dashing) {
      sx *= 0.82;
      sy *= 0.85;
      sz *= 1.35;
    }
    const fuse = isHolder ? fuseRemaining(s) : null;
    let shakeX = 0;
    if (fuse !== null && fuse < 2) shakeX = Math.sin(performance.now() * 0.06) * 0.06 * (1 - fuse / 2);

    drive.current.speed = speed;
    drive.current.state = s.phase === 'finished' && s.winnerId === id ? 'win' : dashing ? 'dash' : speed > 0.6 ? 'run' : 'idle';

    if (s.phase === 'finished' && s.winnerId === id) {
      // the cheer is in the animation; just turn to face the camera
      body.current.position.set(0, 0, 0);
      body.current.rotation.x = 0;
      root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, 0, Math.min(1, dt * 5));
    } else {
      body.current.position.set(shakeX, bob, 0);
      body.current.rotation.x = moving * 0.18 + (dashing ? 0.25 : 0);
      body.current.rotation.y = 0;
    }
    body.current.scale.set(sx, sy, sz);

    // Shield bubble.
    if (shield.current && shieldMat.current) {
      const on = !!p.shield && s.time < p.shieldUntil;
      shield.current.visible = on;
      if (on) {
        shieldMat.current.color.set(p.shield === 'reflect' ? '#ff5fa2' : '#4fc3ff');
        shieldMat.current.emissive.set(p.shield === 'reflect' ? '#ff5fa2' : '#4fc3ff');
        const pulse = 1 + Math.sin(performance.now() * 0.02) * 0.04;
        shield.current.scale.setScalar(pulse);
      }
    }
    if (slowRing.current) {
      slowRing.current.visible = s.time < p.slowUntil;
      slowRing.current.rotation.z += dt * 3;
    }
  });

  return (
    <group ref={root}>
      <group ref={body}>
        <Suspense fallback={<group scale={1.2}><Model id={player.character} /></group>}>
          <CrewMember id={player.character} bot={player.isBot} seat={seat} drive={drive} />
        </Suspense>
      </group>
      <mesh ref={shield} position={[0, 0.6, 0]} visible={false}>
        <sphereGeometry args={[0.85, 24, 16]} />
        <meshStandardMaterial ref={shieldMat} transparent opacity={0.28} emissiveIntensity={0.8} depthWrite={false} />
      </mesh>
      <mesh ref={slowRing} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.55, 0.7, 6]} />
        <meshBasicMaterial color="#ffb347" transparent opacity={0.8} />
      </mesh>
      {/* the player's colour, as a ring on the ground, so every pirate reads as its seat from above */}
      {/* while spectating: a slow pulse under whoever the camera is following */}
      <mesh ref={marker} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.78, 0.9, 40]} />
        <meshBasicMaterial color="#f0d391" transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.64, 32]} />
        <meshBasicMaterial color={ring} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      {/* Blob shadow for readability even with shadows disabled */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.45, 20]} />
        <meshBasicMaterial color="#000" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}
