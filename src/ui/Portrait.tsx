import { characterDef } from '../game/content';
import type { CharacterId } from '../game/types';
import { portraitKey, usePortrait } from '../render/portraits';

/** A crew member's headshot in a colour disc (just the disc until the headshot has rendered). */
export function Portrait({ id, bot = false, seat = 0, size = 44, className = '' }: { id: CharacterId; bot?: boolean; seat?: number; size?: number; className?: string }) {
  const src = usePortrait(portraitKey(id, bot, seat));
  const c = characterDef(id);
  return (
    <span className={`portrait ${className}`} style={{ '--c': c.color, width: size, height: size } as React.CSSProperties} title={c.name}>
      {src && <img src={src} alt="" draggable={false} />}
    </span>
  );
}
