import { useSyncExternalStore } from 'react';

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  reducedShake: boolean;
  reducedEffects: boolean;
  shadows: boolean;
  aimGuide: boolean;
}

const DEFAULTS: Settings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  reducedShake: false,
  reducedEffects: false,
  shadows: true,
  aimGuide: true,
};

const KEY = 'blowup.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // ignore corrupt settings
  }
  return { ...DEFAULTS };
}

let current = load();
const listeners = new Set<() => void>();

export const getSettings = (): Settings => current;

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage may be unavailable (private mode)
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

// Guest profile (name + character) for instant replays.
const PROFILE_KEY = 'blowup.profile.v1';
export interface Profile {
  name: string;
  character: import('../game/types').CharacterId;
}
export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}
