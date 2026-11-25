/**
 * BlowUp's icon set: chunky, hand-built SVGs in one style (24×24, a thick ink outline, a flat colour fill),
 * so nothing in the UI depends on emoji fonts. `fill` defaults to the current text colour.
 */
import type { CSSProperties } from 'react';

const INK = '#1b1a22';

export type IconName =
  | 'bomb' | 'boom' | 'arrow' | 'gear' | 'info' | 'dash' | 'check' | 'prev' | 'next'
  | 'reflect' | 'shield' | 'sprint' | 'swap' | 'slow' | 'clock' | 'crown' | 'skull';

export function Icon({ name, size = 22, fill = 'currentColor', style, title }: { name: IconName; size?: number; fill?: string; style?: CSSProperties; title?: string }) {
  const o = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  let body: JSX.Element;
  switch (name) {
    case 'bomb':
      body = (
        <>
          <circle cx="10.5" cy="14" r="7.2" fill={fill === 'currentColor' ? '#2a2833' : fill} {...o} />
          <circle cx="8" cy="11.5" r="1.8" fill="#ffffff" opacity="0.55" />
          <rect x="11.6" y="4.6" width="5" height="3.6" rx="1" transform="rotate(35 14 6.4)" fill="#5a5866" {...o} />
          <path d="M16.6 4.2 Q18.4 1.6 21 2.6" fill="none" {...o} />
          <path d="M20.6 1.2 l0.6 1.6 1.6 0.4 -1.4 0.9 0.2 1.7 -1.2 -1.1 -1.5 0.6 0.5 -1.6 -1 -1.3 1.7 0z" fill="#ffb347" stroke={INK} strokeWidth="0.9" strokeLinejoin="round" />
        </>
      );
      break;
    case 'boom':
      body = (
        <>
          <path d="M12 1.8 L14.4 7.4 L20.6 5.2 L17.4 10.6 L22.6 13.4 L16.6 14.8 L18.2 21 L12.6 17.4 L8.2 22 L8 16 L1.8 15.6 L6.6 11.6 L3 6.4 L9.2 7.6 Z" fill={fill === 'currentColor' ? '#ff6b35' : fill} {...o} />
          <path d="M12 7.6 L13.4 11 L16.8 10.4 L14.6 13 L16 15.8 L12.6 14.6 L10.4 17.2 L10.2 13.8 L7 13 L9.8 11.2 Z" fill="#ffd23f" stroke="none" />
        </>
      );
      break;
    case 'arrow':
      body = <path d="M4 3.5 L21 12 L4 20.5 L7.5 12 Z" fill={fill} {...o} />;
      break;
    case 'gear':
      body = (
        <>
          <path d="M10.2 2.2h3.6l.6 2.6 2.1 1 2.3-1.4 2.5 2.5-1.4 2.3 1 2.1 2.6.6v3.6l-2.6.6-1 2.1 1.4 2.3-2.5 2.5-2.3-1.4-2.1 1-.6 2.6h-3.6l-.6-2.6-2.1-1-2.3 1.4-2.5-2.5 1.4-2.3-1-2.1-2.6-.6v-3.6l2.6-.6 1-2.1-1.4-2.3 2.5-2.5 2.3 1.4 2.1-1z" fill={fill} {...o} />
          <circle cx="12" cy="12" r="3.4" fill={INK} />
        </>
      );
      break;
    case 'info':
      body = (
        <>
          <circle cx="12" cy="12" r="9.5" fill={fill} {...o} />
          <rect x="10.6" y="10.4" width="2.8" height="7" rx="1.2" fill={INK} />
          <circle cx="12" cy="7.2" r="1.7" fill={INK} />
        </>
      );
      break;
    case 'dash':
      body = <path d="M13.5 1.8 L4.6 13.4 H11 L9.6 22.2 L19.4 9.8 H12.8 Z" fill={fill === 'currentColor' ? '#ffd23f' : fill} {...o} />;
      break;
    case 'check':
      body = <path d="M3.5 12.5 L9.2 18 L20.5 6" fill="none" stroke={fill === 'currentColor' ? '#5fbf4a' : fill} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />;
      break;
    case 'prev':
      body = <path d="M16.5 3.5 L6 12 L16.5 20.5 Z" fill={fill} {...o} />;
      break;
    case 'next':
      body = <path d="M7.5 3.5 L18 12 L7.5 20.5 Z" fill={fill} {...o} />;
      break;
    case 'reflect':
      body = (
        <>
          <path d="M19 15.5 A7 7 0 1 1 15.8 6" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" />
          <path d="M19 15.5 A7 7 0 1 1 15.8 6" fill="none" stroke={fill} strokeWidth="3" strokeLinecap="round" />
          <path d="M13.2 2.4 L20 5.4 L15.4 10.6 Z" fill={fill} {...o} />
        </>
      );
      break;
    case 'shield':
      body = (
        <>
          <path d="M12 2.2 L20.2 5.2 V11.4 C20.2 16.4 16.6 20 12 21.8 C7.4 20 3.8 16.4 3.8 11.4 V5.2 Z" fill={fill} {...o} />
          <path d="M12 5.4 V18.4" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
        </>
      );
      break;
    case 'sprint':
      body = (
        <>
          <path d="M3 4 L11 12 L3 20 Z" fill={fill} {...o} />
          <path d="M12 4 L20 12 L12 20 Z" fill={fill} {...o} />
        </>
      );
      break;
    case 'swap':
      body = (
        <>
          <path d="M3 8.5 H16 V5 L21.5 10 L16 15 V11.5 H3 Z" fill={fill} {...o} transform="translate(0 -2)" />
          <path d="M21 15.5 H8 V12 L2.5 17 L8 22 V18.5 H21 Z" fill={fill} {...o} />
        </>
      );
      break;
    case 'slow':
      body = (
        <>
          <path d="M3 18.5 H17.5 C20.5 18.5 21.6 15.8 20.4 13.8 L19 11.4" fill="none" {...o} />
          <circle cx="11" cy="12.2" r="5.8" fill={fill} {...o} />
          <path d="M11 12.2 m-2.6 0 a2.6 2.6 0 1 1 2.6 2.6" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M19.2 11.6 L20.4 6.6 M21.2 12 L23 7.6" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <circle cx="12" cy="13" r="8.6" fill={fill} {...o} />
          <rect x="9.6" y="1.4" width="4.8" height="2.6" rx="1" fill={fill} {...o} />
          <path d="M12 13 V8.2 M12 13 L15.6 15" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
        </>
      );
      break;
    case 'crown':
      body = <path d="M2.8 8 L7.4 12.4 L12 4.4 L16.6 12.4 L21.2 8 L19.4 19.6 H4.6 Z" fill={fill === 'currentColor' ? '#ffd23f' : fill} {...o} />;
      break;
    case 'skull':
      body = (
        <>
          <path d="M12 2.6 C6.8 2.6 3.6 6.2 3.6 10.6 C3.6 13.6 5.2 15.4 7 16.4 V20.4 H17 V16.4 C18.8 15.4 20.4 13.6 20.4 10.6 C20.4 6.2 17.2 2.6 12 2.6 Z" fill={fill === 'currentColor' ? '#f2ecdf' : fill} {...o} />
          <circle cx="8.8" cy="11" r="2.1" fill={INK} />
          <circle cx="15.2" cy="11" r="2.1" fill={INK} />
          <path d="M10.6 20.4 V17.8 M13.4 20.4 V17.8" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        </>
      );
      break;
  }
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} style={{ display: 'inline-block', verticalAlign: '-0.18em', overflow: 'visible', ...style }} role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}>
      {body}
    </svg>
  );
}
