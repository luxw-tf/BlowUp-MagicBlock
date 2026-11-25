/**
 * How each weather changes the light of a time of day, and what moves in it. Plain data (no React), shared by the
 * arena, the weather layer and the menu. Weather never changes the rules online: this is all looks.
 */
import * as THREE from 'three';
import { currentMood, currentWeather, type Mood, type Weather } from '../game/arena';

/** Light for each time of day. Sun position is where the light comes from; water tint multiplies the sea. */
export interface Light {
  sky: string; fogNear: number; fogFar: number;
  sun: string; sunI: number; sunPos: [number, number, number];
  hemiSky: string; hemiGround: string; hemiI: number;
  water: [number, number, number]; lamps: boolean; exposure: number;
}

/** What moves: everything is 0..1 unless noted. */
export interface Look {
  /** sway of palms and flags, drift of smoke, dust and rain (1 = a stiff breeze) */
  wind: number;
  /** rain streaks and rings on the water (storm > 1) */
  rain: number;
  /** falling snow and how white the deck has gone */
  snow: number;
  /** streaks of wind racing over the deck, so you can see which way it blows */
  gusts: number;
  /** cloud shadows drifting over the deck */
  clouds: number;
  /** wet sheen and puddles on the deck */
  wet: number;
  lightning: boolean;
  /** lamp heads glow even by day (gloomy weather) */
  glow: boolean;
  /** what drifts in the air: dust and leaves by day, fireflies at night */
  motes: 'day' | 'night' | 'none';
  /** how many motes, 0..1 */
  moteAmt: number;
}

const mixHex = (a: string, b: string, k: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

export function weatherLight(L: Light, w: Weather, mood: Mood): Light {
  const night = mood === 'night';
  switch (w) {
    case 'clear':
    case 'breezy':
      return L;
    case 'rain':
      return {
        ...L,
        sky: mixHex(L.sky, night ? '#121a26' : '#8d99a4', 0.75),
        fogNear: L.fogNear * 0.65, fogFar: L.fogFar * 0.6,
        sun: mixHex(L.sun, '#dfe7f0', 0.6), sunI: L.sunI * (night ? 0.7 : 0.42),
        hemiSky: mixHex(L.hemiSky, night ? '#2a3550' : '#b4c0cc', 0.6), hemiI: L.hemiI * (night ? 1.05 : 1.12),
        water: [L.water[0] * 0.78, L.water[1] * 0.84, L.water[2] * 0.88],
        exposure: L.exposure * 0.97,
      };
    case 'fog':
      // the deck stays clear (the camera is ~45 units off it); the sea and the far boats melt into a soft haze
      return {
        ...L,
        sky: mixHex(L.sky, night ? '#2a3446' : '#d9e0e3', 0.8),
        fogNear: night ? 30 : 34, fogFar: night ? 78 : 92,
        sunI: L.sunI * 0.6,
        hemiSky: mixHex(L.hemiSky, night ? '#3a4660' : '#e6ecef', 0.5), hemiI: L.hemiI * 1.15,
        water: [L.water[0] * 0.92, L.water[1] * 0.95, L.water[2] * 0.95],
      };
    case 'snow':
      // a white-out sky, soft flat light, the sea gone steel-grey
      return {
        ...L,
        sky: mixHex(L.sky, night ? '#2b3446' : '#dfe5ea', 0.8),
        fogNear: L.fogNear * 0.7, fogFar: L.fogFar * 0.7,
        sun: mixHex(L.sun, '#eef3ff', 0.7), sunI: L.sunI * (night ? 0.8 : 0.55),
        hemiSky: mixHex(L.hemiSky, night ? '#46557a' : '#f0f4f8', 0.6), hemiI: L.hemiI * 1.2,
        water: [L.water[0] * 0.62, L.water[1] * 0.72, L.water[2] * 0.8],
      };
    case 'storm':
      return {
        ...L,
        sky: mixHex(L.sky, night ? '#070c16' : '#4a5563', 0.8),
        fogNear: L.fogNear * 0.55, fogFar: L.fogFar * 0.55,
        sun: '#b4c4e6', sunI: L.sunI * (night ? 0.6 : 0.3),
        hemiSky: mixHex(L.hemiSky, '#263248', 0.5), hemiI: L.hemiI * (night ? 0.95 : 0.8),
        water: [L.water[0] * 0.7, L.water[1] * 0.76, L.water[2] * 0.82],
        lamps: true,
      };
  }
}

export function weatherLook(w: Weather, mood: Mood): Look {
  const night = mood === 'night';
  const motes = night ? 'night' : 'day';
  switch (w) {
    case 'clear':
      return { wind: 0.35, rain: 0, snow: 0, gusts: 0, clouds: night ? 0 : 0.5, wet: 0, lightning: false, glow: false, motes, moteAmt: 0.6 };
    case 'breezy':
      return { wind: 1, rain: 0, snow: 0, gusts: 1, clouds: night ? 0 : 0.8, wet: 0, lightning: false, glow: false, motes, moteAmt: 1 };
    case 'rain':
      return { wind: 0.6, rain: 1, snow: 0, gusts: 0, clouds: 0, wet: 1, lightning: false, glow: true, motes: 'none', moteAmt: 0 };
    case 'fog':
      return { wind: 0.15, rain: 0, snow: 0, gusts: 0, clouds: 0, wet: 0.35, lightning: false, glow: true, motes, moteAmt: 0.35 };
    case 'storm':
      return { wind: 1.6, rain: 1.5, snow: 0, gusts: 1.2, clouds: 0, wet: 1, lightning: true, glow: true, motes: 'none', moteAmt: 0 };
    case 'snow':
      return { wind: 0.7, rain: 0, snow: 1, gusts: 0.5, clouds: 0, wet: 0.2, lightning: false, glow: true, motes: 'none', moteAmt: 0 };
  }
}

/** The look of the current match (or menu), cached per mood and weather. */
const cache = new Map<string, { light: Light; look: Look }>();
export function resolveWeather(base: Record<Mood, Light>) {
  const mood = currentMood(), w = currentWeather(), key = `${mood}-${w}`;
  let hit = cache.get(key);
  if (!hit) cache.set(key, (hit = { light: weatherLight(base[mood], w, mood), look: weatherLook(w, mood) }));
  return hit;
}

/**
 * Shared uniforms for everything that moves with the weather: one clock and one wind for every shader, set once a
 * frame by <AmbientClock>. Every material that sways or drifts reads these objects directly.
 */
export const AMBIENT = {
  uTime: { value: 0 },
  uWind: { value: 0.35 },
  /** the wind's direction on the ground (x, z): from the west, a little off the sea */
  uWindDir: { value: new THREE.Vector2(1, 0.25).normalize() },
  uRain: { value: 0 },
  uClouds: { value: 0 },
  uWet: { value: 0 },
  uSnow: { value: 0 },
  /** 0..1 flash from lightning, for the materials that want it */
  uFlash: { value: 0 },
};
