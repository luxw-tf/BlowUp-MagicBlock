/**
 * Map 01: The Docks — blockout-plus. Static geometry built from primitives
 * with procedural textures. Visual richness lives outside the playable area;
 * inside it stays clean and readable. Final art replaces this in Phase 04.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ARENA, OBSTACLES } from '../game/arena';

function makeFloorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1152;
  c.height = 640;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d4d6d3';
  g.fillRect(0, 0, c.width, c.height);
  // Slab variation
  const tile = 64; // 2 units per tile (36×20 → 18×10 tiles)
  for (let y = 0; y < c.height; y += tile) {
    for (let x = 0; x < c.width; x += tile) {
      const shade = 200 + Math.floor(Math.random() * 22);
      g.fillStyle = `rgb(${shade},${shade + 2},${shade})`;
      g.fillRect(x + 1, y + 1, tile - 2, tile - 2);
      // speckle
      for (let i = 0; i < 18; i++) {
        g.fillStyle = `rgba(90,90,85,${Math.random() * 0.08})`;
        g.fillRect(x + Math.random() * tile, y + Math.random() * tile, 2, 2);
      }
    }
  }
  // Grout lines
  g.strokeStyle = 'rgba(120,124,120,0.55)';
  g.lineWidth = 2;
  for (let x = 0; x <= c.width; x += tile) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, c.height);
    g.stroke();
  }
  for (let y = 0; y <= c.height; y += tile) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(c.width, y);
    g.stroke();
  }
  // Painted yellow markings (stylised dock lines)
  g.fillStyle = 'rgba(240,190,40,0.7)';
  for (let i = 0; i < 6; i++) g.fillRect(90 + i * 34, 560, 20, 8);
  for (let i = 0; i < 6; i++) g.fillRect(860 + i * 34, 70, 20, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeConcreteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8d949a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,60,70' : '200,200,210'},${Math.random() * 0.12})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  g.strokeStyle = 'rgba(60,64,70,0.4)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 12);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCrateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c99a5b';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    g.fillStyle = y % 32 === 0 ? '#b88849' : '#d2a566';
    g.fillRect(0, y, 128, 15);
  }
  g.strokeStyle = '#7a5428';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  g.beginPath();
  g.moveTo(8, 8);
  g.lineTo(120, 120);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Container({ position, rotation = 0, color }: { position: [number, number, number]; rotation?: number; color: string }) {
  const ribs = useMemo(() => Array.from({ length: 12 }, (_, i) => -2.75 + i * 0.5), []);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 1.3, 0]}>
        <boxGeometry args={[6, 2.6, 2.4]} />
        <meshStandardMaterial color={color} roughness={0.75} metalness={0.15} />
      </mesh>
      {ribs.map((x) => (
        <mesh key={x} position={[x, 1.3, 1.21]}>
          <boxGeometry args={[0.12, 2.4, 0.04]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 2.62, 0]}>
        <boxGeometry args={[6.05, 0.06, 2.45]} />
        <meshStandardMaterial color="#3b3f45" />
      </mesh>
    </group>
  );
}

function Barrel({ position, color = '#2f6fb5' }: { position: [number, number, number]; color?: string }) {
  return (
    <mesh castShadow position={[position[0], 0.5, position[2]]}>
      <cylinderGeometry args={[0.38, 0.38, 1, 14]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
    </mesh>
  );
}

function Bollard({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.18, 0.24, 0.6, 10]} />
        <meshStandardMaterial color="#2c3036" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <cylinderGeometry args={[0.26, 0.18, 0.08, 10]} />
        <meshStandardMaterial color="#2c3036" />
      </mesh>
    </group>
  );
}

function Plant({ position, s = 1 }: { position: [number, number, number]; s?: number }) {
  return (
    <group position={position} scale={s}>
      <mesh castShadow position={[0, 0.3, 0]}>
        <sphereGeometry args={[0.45, 10, 8]} />
        <meshStandardMaterial color="#4f9a3a" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.35, 0.22, 0.1]}>
        <sphereGeometry args={[0.3, 10, 8]} />
        <meshStandardMaterial color="#62b04a" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Crane({ position }: { position: [number, number, number] }) {
  const yellow = '#f0b429';
  return (
    <group position={position}>
      {[-1.5, 1.5].map((x) =>
        [-1.2, 1.2].map((z) => (
          <mesh key={`${x}${z}`} castShadow position={[x, 4, z]}>
            <boxGeometry args={[0.3, 8, 0.3]} />
            <meshStandardMaterial color={yellow} roughness={0.5} />
          </mesh>
        )),
      )}
      <mesh castShadow position={[0, 8.2, 0]}>
        <boxGeometry args={[3.6, 0.6, 2.8]} />
        <meshStandardMaterial color={yellow} />
      </mesh>
      <mesh castShadow position={[4, 8.9, 0]}>
        <boxGeometry args={[11, 0.4, 0.6]} />
        <meshStandardMaterial color={yellow} />
      </mesh>
      <mesh position={[8, 6.5, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 4.6, 4]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </group>
  );
}

function Boat({ position, rotation = 0, color = '#e8eef2' }: { position: [number, number, number]; rotation?: number; color?: string }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[7, 1, 2.4]} />
        <meshStandardMaterial color="#2c3e50" />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <boxGeometry args={[6.6, 0.15, 2.2]} />
        <meshStandardMaterial color="#b0413e" />
      </mesh>
      <mesh position={[-1.5, 1.5, 0]}>
        <boxGeometry args={[2.4, 1.2, 1.8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[-1.5, 2.4, 0]}>
        <boxGeometry args={[1.4, 0.6, 1.4]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

function Water() {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = 0.18 + Math.sin(clock.elapsedTime * 0.8) * 0.04;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, -40]} receiveShadow>
      <planeGeometry args={[200, 60]} />
      <meshStandardMaterial ref={mat} color="#1f8fc4" emissive="#0b6a9e" emissiveIntensity={0.18} roughness={0.25} metalness={0.1} />
    </mesh>
  );
}

function Basin({ r }: { r: number }) {
  const water = useRef<THREE.Mesh>(null);
  const spout = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (water.current) water.current.position.y = 0.42 + Math.sin(t * 1.6) * 0.02;
    if (spout.current) spout.current.scale.y = 1 + Math.sin(t * 7) * 0.08;
  });
  return (
    <group>
      {/* Outer wall, inner wall and basin floor: open so the water reads from above */}
      <mesh castShadow receiveShadow position={[0, 0.26, 0]}>
        <cylinderGeometry args={[r, r + 0.1, 0.52, 40, 1, true]} />
        <meshStandardMaterial color="#9aa3a8" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <cylinderGeometry args={[r - 0.3, r - 0.3, 0.22, 40, 1, true]} />
        <meshStandardMaterial color="#7d878c" roughness={0.9} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[r - 0.3, r - 0.3, 0.3, 40]} />
        <meshStandardMaterial color="#5f7f8a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.52, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r - 0.3, r, 40]} />
        <meshStandardMaterial color="#b9c0c3" roughness={0.8} />
      </mesh>
      <mesh ref={water} position={[0, 0.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r - 0.3, 40]} />
        <meshStandardMaterial color="#3fb7e6" emissive="#1a8fc0" emissiveIntensity={0.35} roughness={0.15} transparent opacity={0.92} />
      </mesh>
      <mesh castShadow position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.35, 0.5, 0.9, 16]} />
        <meshStandardMaterial color="#8d969b" roughness={0.8} />
      </mesh>
      <mesh ref={spout} position={[0, 1.4, 0]}>
        <coneGeometry args={[0.25, 0.8, 12]} />
        <meshStandardMaterial color="#a9e6ff" transparent opacity={0.6} emissive="#7fd6ff" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

export function Arena({ shadows }: { shadows: boolean }) {
  const floorTex = useMemo(makeFloorTexture, []);
  const concreteTex = useMemo(makeConcreteTexture, []);
  const crateTex = useMemo(makeCrateTexture, []);
  const W = ARENA.halfWidth * 2;
  const D = ARENA.halfDepth * 2;

  return (
    <group>
      <hemisphereLight args={['#dff2ff', '#7a6a55', 0.85]} />
      <directionalLight
        position={[-14, 24, 12]}
        intensity={1.9}
        color="#fff1d6"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0006}
      />

      {/* Surrounding dock */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 2]} receiveShadow>
        <planeGeometry args={[80, 30]} />
        <meshStandardMaterial map={concreteTex} roughness={0.95} />
      </mesh>
      {/* Dock edge / quay wall at the back */}
      <mesh position={[0, -0.32, -13]} receiveShadow>
        <boxGeometry args={[80, 0.6, 0.4]} />
        <meshStandardMaterial color="#6d747b" />
      </mesh>
      <Water />

      {/* Playable floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floorTex} roughness={0.9} />
      </mesh>
      {/* Hazard-yellow boundary trim (low so it never occludes play) */}
      {[
        [0, -ARENA.halfDepth - 0.12, W + 0.48, 0.24],
        [0, ARENA.halfDepth + 0.12, W + 0.48, 0.24],
      ].map(([x, z, w, d], i) => (
        <mesh key={`h${i}`} position={[x, 0.08, z]} receiveShadow>
          <boxGeometry args={[w, 0.16, d]} />
          <meshStandardMaterial color="#f0b429" roughness={0.6} />
        </mesh>
      ))}
      {[-1, 1].map((sx) => (
        <mesh key={`v${sx}`} position={[sx * (ARENA.halfWidth + 0.12), 0.08, 0]} receiveShadow>
          <boxGeometry args={[0.24, 0.16, D]} />
          <meshStandardMaterial color="#f0b429" roughness={0.6} />
        </mesh>
      ))}
      {/* Back railing */}
      {Array.from({ length: 19 }, (_, i) => -18 + i * 2).map((x) => (
        <mesh key={`rail${x}`} position={[x, 0.45, -ARENA.halfDepth - 0.6]} castShadow>
          <boxGeometry args={[0.08, 0.9, 0.08]} />
          <meshStandardMaterial color="#4a5560" />
        </mesh>
      ))}
      <mesh position={[0, 0.9, -ARENA.halfDepth - 0.6]}>
        <boxGeometry args={[36.2, 0.08, 0.08]} />
        <meshStandardMaterial color="#4a5560" />
      </mesh>

      {/* Obstacles from the authoritative arena definition */}
      {OBSTACLES.map((o, i) =>
        o.kind === 'circle' ? (
          <group key={i} position={[o.x, 0, o.z]}>
            <Basin r={o.r} />
          </group>
        ) : (
          <group key={i} position={[o.x, 0, o.z]}>
            <mesh castShadow receiveShadow position={[0, 0.65, 0]}>
              <boxGeometry args={[o.hw * 2, 1.3, o.hd * 2]} />
              <meshStandardMaterial map={crateTex} roughness={0.85} />
            </mesh>
            <mesh castShadow position={[o.hw * 0.25, 1.5, -o.hd * 0.2]} rotation={[0, 0.4, 0]}>
              <boxGeometry args={[Math.min(0.8, o.hw * 1.1), 0.4, Math.min(0.8, o.hd * 1.1)]} />
              <meshStandardMaterial map={crateTex} roughness={0.85} />
            </mesh>
          </group>
        ),
      )}

      {/* Decoration — outside the playable area */}
      <Container position={[-23, 0, -6]} rotation={Math.PI / 2} color="#c4502f" />
      <Container position={[-23, 0, 3]} rotation={Math.PI / 2} color="#2f5fa8" />
      <Container position={[-23, 2.6, -1.5]} rotation={Math.PI / 2} color="#d9822b" />
      <Container position={[23, 0, -5]} rotation={Math.PI / 2} color="#2f5fa8" />
      <Container position={[23, 0, 4]} rotation={Math.PI / 2} color="#c4502f" />
      <Container position={[-14, 0, -15.5]} color="#2f5fa8" />
      <Container position={[22, 0, -13]} color="#7f8c3a" />
      <Crane position={[-6, 0, -16]} />
      <Boat position={[10, -0.4, -24]} rotation={0.15} />
      <Boat position={[-22, -0.4, -30]} rotation={-0.3} color="#f4d35e" />
      {[
        [-20, 0, -10.6],
        [-19.6, 0, -9.6],
        [20.2, 0, 9],
        [19.8, 0, 10],
        [21, 0, -9.5],
      ].map((p, i) => (
        <Barrel key={i} position={p as [number, number, number]} color={i % 2 ? '#2f6fb5' : '#c4502f'} />
      ))}
      {[-15, -9, -3, 3, 9, 15].map((x) => (
        <Bollard key={x} position={[x, 0, ARENA.halfDepth + 1.1]} />
      ))}
      <Plant position={[-19.5, 0, 7.5]} s={1.2} />
      <Plant position={[19.8, 0, -1]} s={1.1} />
      <Plant position={[-19.8, 0, -3]} />
      <Plant position={[-8, 1.3, 4.6]} s={0.5} />
      <Plant position={[8, 1.3, -3.8]} s={0.5} />
    </group>
  );
}
