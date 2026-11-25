import { createContext, useContext } from 'react';
import type { SessionLike } from '../game/sessionTypes';
import type { InputController } from '../input/input';
import type { PlayerId } from '../game/types';

export interface GameCtx {
  session: SessionLike;
  input: InputController;
  /** Who the camera follows (local player, or a survivor while spectating). */
  focus: { id: PlayerId };
  /** Shared smoothed render positions, written by creatures each frame. */
  renderPos: Map<PlayerId, { x: number; z: number }>;
  shake: { amount: number };
}

export const GameContext = createContext<GameCtx | null>(null);

export function useGame(): GameCtx {
  const c = useContext(GameContext);
  if (!c) throw new Error('GameContext missing');
  return c;
}

/**
 * DOM overlay registry: HUD elements that the canvas positions every frame
 * (name tags, off-screen bomb indicator). Written imperatively to avoid
 * re-rendering React at 60 FPS.
 */
export const overlay = {
  tags: new Map<PlayerId, HTMLElement>(),
  indicator: null as HTMLElement | null,
};
