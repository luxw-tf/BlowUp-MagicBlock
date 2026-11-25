/**
 * BlowUp's icon set: thin line icons drawn in one style (24×24 grid, 1.7 stroke, round joins), coloured by the
 * text colour, so they sit quietly in the dark-and-gold UI. `fill` adds a flat accent where an icon has one.
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'bomb' | 'boom' | 'arrow' | 'gear' | 'info' | 'dash' | 'check' | 'prev' | 'next'
  | 'reflect' | 'shield' | 'sprint' | 'swap' | 'slow' | 'clock' | 'crown' | 'skull' | 'pencil';

export function Icon({ name, size = 22, fill, style, title }: { name: IconName; size?: number; fill?: string; style?: CSSProperties; title?: string }) {
  const o = { stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const, fill: 'none' };
  const accent = fill ?? 'none';
  let body: JSX.Element;
  switch (name) {
    case 'bomb':
      body = (
        <>
          <circle cx="10.5" cy="14" r="6.8" {...o} fill={accent} />
          <path d="M7.4 12.2 A3.4 3.4 0 0 1 9.6 10.2" {...o} />
          <path d="M14.6 9.2 L16.4 7.4" {...o} />
          <path d="M16.4 7.4 C17.4 5.2 19.2 4.6 20.6 4.8" {...o} />
          <path d="M20.6 2.2 V3.4 M22.4 4.8 H21.2 M21.9 3 L21.1 3.8" {...o} strokeWidth={1.4} />
        </>
      );
      break;
    case 'boom':
      body = <path d="M12 2.5 L13.9 8 L19.6 6.2 L16.4 11.2 L21.4 14 L15.6 14.9 L16.6 20.8 L12 17.2 L7.4 20.8 L8.4 14.9 L2.6 14 L7.6 11.2 L4.4 6.2 L10.1 8 Z" {...o} fill={accent} />;
      break;
    case 'arrow':
      body = <path d="M5 4 L20 12 L5 20 L8 12 Z" {...o} fill={accent} />;
      break;
    case 'gear':
      body = (
        <>
          <circle cx="12" cy="12" r="3.2" {...o} />
          <path d="M12 2.8 V5.2 M12 18.8 V21.2 M2.8 12 H5.2 M18.8 12 H21.2 M5.5 5.5 L7.2 7.2 M16.8 16.8 L18.5 18.5 M5.5 18.5 L7.2 16.8 M16.8 7.2 L18.5 5.5" {...o} />
          <circle cx="12" cy="12" r="6.6" {...o} />
        </>
      );
      break;
    case 'info':
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...o} />
          <path d="M12 11 V16.8" {...o} />
          <circle cx="12" cy="7.6" r="0.9" fill="currentColor" />
        </>
      );
      break;
    case 'dash':
      body = <path d="M13.4 2.6 L5.4 13.2 H11.2 L10 21.4 L18.6 10.2 H12.6 Z" {...o} fill={accent} />;
      break;
    case 'check':
      body = <path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" {...o} strokeWidth={2.2} />;
      break;
    case 'prev':
      body = <path d="M15 4.5 L7.5 12 L15 19.5" {...o} strokeWidth={2} />;
      break;
    case 'next':
      body = <path d="M9 4.5 L16.5 12 L9 19.5" {...o} strokeWidth={2} />;
      break;
    case 'reflect':
      body = (
        <>
          <path d="M18.6 15.4 A7.2 7.2 0 1 1 15.6 5.8" {...o} />
          <path d="M14 2.8 L18.6 5.2 L15.2 9.4" {...o} />
        </>
      );
      break;
    case 'shield':
      body = <path d="M12 2.6 L19.6 5.4 V11.4 C19.6 16.2 16.2 19.6 12 21.4 C7.8 19.6 4.4 16.2 4.4 11.4 V5.4 Z" {...o} fill={accent} />;
      break;
    case 'sprint':
      body = (
        <>
          <path d="M4 5 L11 12 L4 19" {...o} />
          <path d="M12 5 L19 12 L12 19" {...o} />
        </>
      );
      break;
    case 'swap':
      body = (
        <>
          <path d="M4 8 H19 M15.5 4.5 L19 8 L15.5 11.5" {...o} />
          <path d="M20 16 H5 M8.5 12.5 L5 16 L8.5 19.5" {...o} />
        </>
      );
      break;
    case 'slow':
      body = (
        <>
          <path d="M3.5 18.5 H18 C20.2 18.5 21 16.4 20 14.8 L18.8 12.8" {...o} />
          <circle cx="11" cy="12.6" r="5.4" {...o} fill={accent} />
          <path d="M11 12.6 m-2.2 0 a2.2 2.2 0 1 1 2.2 2.2" {...o} strokeWidth={1.3} />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <circle cx="12" cy="13" r="8" {...o} fill={accent} />
          <path d="M10 2.6 H14 M12 13 V8.6 M12 13 L15 15" {...o} />
        </>
      );
      break;
    case 'crown':
      body = <path d="M3.4 8 L7.6 12 L12 4.6 L16.4 12 L20.6 8 L18.8 19 H5.2 Z" {...o} fill={accent} />;
      break;
    case 'skull':
      body = (
        <>
          <path d="M12 3 C7.2 3 4.2 6.4 4.2 10.6 C4.2 13.4 5.6 15.2 7.4 16.2 V20 H16.6 V16.2 C18.4 15.2 19.8 13.4 19.8 10.6 C19.8 6.4 16.8 3 12 3 Z" {...o} fill={accent} />
          <circle cx="9" cy="11" r="1.7" fill="currentColor" />
          <circle cx="15" cy="11" r="1.7" fill="currentColor" />
        </>
      );
      break;
    case 'pencil':
      body = (
        <>
          <path d="M4 20 L5 15 L16 4 L20 8 L9 19 Z" {...o} />
          <path d="M14 6 L18 10" {...o} />
        </>
      );
      break;
  }
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" style={{ display: 'inline-block', verticalAlign: 'middle', flex: 'none', ...style }} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {body}
    </svg>
  );
}
