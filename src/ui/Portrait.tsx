import { characterDef } from '../game/content';
import type { CharacterId } from '../game/types';
import { usePortrait } from '../render/portraits';

/** A pirate's headshot in a colour disc (just the disc until the headshot has rendered). */
export function Portrait({ id, size = 44, className = '' }: { id: CharacterId; size?: number; className?: string }) {
  const src = usePortrait(id);
  const c = characterDef(id);
  return (
    <span className={`portrait ${className}`} style={{ '--c': c.color, width: size, height: size } as React.CSSProperties} title={c.name}>
      {src && <img src={src} alt="" draggable={false} />}
    </span>
  );
}
