/**
 * Footprints in the snow: a small texture over the bay where anyone who walks clears the snow, and falling snow
 * slowly fills the tracks back in. The deck's shader reads it (ambient.tsx). Cheap: 192 × 112 bytes, stamped on the
 * CPU once a frame and uploaded only while it is snowing.
 */
import * as THREE from 'three';

const W = 192, H = 112;
/** the area it covers (x0, z0, width, depth), in world units: the bay plus a margin */
export const TRACK_RECT = new THREE.Vector4(-24, -14, 48, 28);
const data = new Uint8Array(W * H).fill(255);
export const trackTexture = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
trackTexture.magFilter = THREE.LinearFilter;
trackTexture.minFilter = THREE.LinearFilter;
trackTexture.needsUpdate = true;

/** Fresh snow everywhere (a new match). */
export function resetTracks() {
  data.fill(255);
  trackTexture.needsUpdate = true;
}

/** Fill the tracks back in a little (seconds to fill completely: ~10 s). */
export function refillTracks(dt: number) {
  const add = Math.max(1, Math.round((255 / 10) * dt));
  for (let i = 0; i < data.length; i++) if (data[i] < 255) data[i] = Math.min(255, data[i] + add);
}

/** Someone stood here: clear a soft-edged patch the size of their feet. */
export function stampTrack(x: number, z: number, radius = 0.42) {
  const sx = W / TRACK_RECT.z, sz = H / TRACK_RECT.w;
  const cx = (x - TRACK_RECT.x) * sx, cz = (z - TRACK_RECT.y) * sz;
  const r = radius * sx;
  for (let j = Math.floor(cz - r - 1); j <= Math.ceil(cz + r + 1); j++) {
    if (j < 0 || j >= H) continue;
    for (let i = Math.floor(cx - r - 1); i <= Math.ceil(cx + r + 1); i++) {
      if (i < 0 || i >= W) continue;
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / r;
      if (d >= 1) continue;
      const v = Math.round(255 * Math.min(1, Math.max(0, (d - 0.35) / 0.65)) * 0.85); // a soft rim, bare in the middle
      const k = j * W + i;
      if (v < data[k]) data[k] = v;
    }
  }
}

export const commitTracks = () => (trackTexture.needsUpdate = true);
