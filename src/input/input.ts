import type { InputFrame, Vec2 } from '../game/types';

/**
 * Captures keyboard and mouse. Movement is camera-relative: the camera looks
 * toward −z, so "up" on screen is −z and "right" is +x. Buttons are latched
 * until the next simulation tick consumes them, so quick taps are never lost.
 */
export class InputController {
  private keys = new Set<string>();
  private latched = { throw: false, tag: false, dash: false, use: false };
  /** Pointer position in normalised device coords (−1..1). */
  pointer = { x: 0, y: 0 };
  /** World-space aim point, written by the camera rig each frame. */
  aimWorld: Vec2 = { x: 0, z: 0 };
  enabled = true;

  private el: HTMLElement | null = null;

  attach(el: HTMLElement) {
    this.dispose();
    this.el = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose() {
    const el = this.el;
    if (!el) return;
    this.el = null;
    this.keys.clear();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('contextmenu', this.onContextMenu);
  }

  sample = (): Omit<InputFrame, 'seq'> => {
    const k = this.keys;
    let x = 0;
    let z = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    }
    const l = Math.hypot(x, z) || 1;
    const frame = {
      move: { x: x / l, z: z / l },
      aim: { ...this.aimWorld },
      ...this.latched,
    };
    this.latched = { throw: false, tag: false, dash: false, use: false };
    return frame;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!this.enabled) return;
    if (!e.repeat) {
      if (e.code === 'Space') this.latched.dash = true;
      if (e.code === 'KeyE') this.latched.use = true;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.el) return;
    const r = this.el.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.onPointerMove(e);
    if (!this.enabled) return;
    if (e.button === 0) this.latched.throw = true;
    if (e.button === 2) this.latched.tag = true;
  };

  private onContextMenu = (e: Event) => e.preventDefault();
}
