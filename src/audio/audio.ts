/**
 * Procedural placeholder audio built on WebAudio. Every sound is synthesised,
 * so there are no asset dependencies yet; swap in recorded SFX in the
 * production pass (PRD Phase 04).
 */
import { getSettings } from '../state/settings';

type Wave = OscillatorType;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private drone: { stop: () => void; setIntensity: (x: number) => void } | null = null;

  /** Must be called from a user gesture before sound can play. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.ctx.destination);
      this.musicBus.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return;
    const s = getSettings();
    this.sfxBus.gain.value = s.master * s.sfx;
    this.musicBus.gain.value = s.master * s.music * 0.6;
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; slideTo?: number; delay?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, opts: { gain?: number; freq?: number; freqTo?: number; q?: number; type?: BiquadFilterType; delay?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.freqTo) f.frequency.exponentialRampToValueAtTime(opts.freqTo, t + dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tick(urgency: number) {
    // urgency 0 (calm) → 1 (about to blow)
    this.tone(900 + urgency * 700, 0.05, { type: 'square', gain: 0.05 + urgency * 0.06 });
  }
  countdown(final: boolean) {
    this.tone(final ? 880 : 520, final ? 0.35 : 0.15, { type: 'triangle', gain: 0.18 });
  }
  transfer() {
    this.tone(160, 0.18, { type: 'sine', gain: 0.45, slideTo: 60 });
    this.noise(0.12, { gain: 0.25, freq: 2500, freqTo: 400 });
    this.tone(660, 0.12, { type: 'triangle', gain: 0.12, delay: 0.04 });
  }
  throwBomb() {
    this.noise(0.22, { gain: 0.18, type: 'bandpass', freq: 600, freqTo: 2400, q: 1.5 });
  }
  miss() {
    this.tone(120, 0.2, { type: 'sine', gain: 0.3, slideTo: 70 });
    this.noise(0.1, { gain: 0.15, freq: 500 });
  }
  explosion() {
    this.noise(1.2, { gain: 0.7, freq: 2200, freqTo: 80 });
    this.tone(90, 0.8, { type: 'sine', gain: 0.6, slideTo: 30 });
    this.tone(45, 1.0, { type: 'triangle', gain: 0.3, slideTo: 25 });
  }
  dash() {
    this.noise(0.14, { gain: 0.14, type: 'highpass', freq: 1500, freqTo: 4000 });
  }
  pickup() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', gain: 0.12, delay: i * 0.05 }));
  }
  reveal() {
    this.tone(1046, 0.25, { type: 'sine', gain: 0.1 });
    this.tone(1568, 0.3, { type: 'sine', gain: 0.08, delay: 0.06 });
  }
  ability(pitch = 1) {
    this.tone(300 * pitch, 0.25, { type: 'sawtooth', gain: 0.08, slideTo: 900 * pitch });
    this.noise(0.15, { gain: 0.1, type: 'bandpass', freq: 1800 * pitch, q: 3 });
  }
  reflect() {
    this.tone(1400, 0.3, { type: 'square', gain: 0.08, slideTo: 2200 });
    this.tone(700, 0.2, { type: 'triangle', gain: 0.15 });
  }
  block() {
    this.tone(220, 0.15, { type: 'square', gain: 0.12, slideTo: 110 });
    this.noise(0.08, { gain: 0.2, freq: 900 });
  }
  fuseReset() {
    this.tone(440, 0.08, { type: 'triangle', gain: 0.1 });
    this.tone(880, 0.1, { type: 'triangle', gain: 0.1, delay: 0.07 });
  }
  denied() {
    this.tone(200, 0.12, { type: 'square', gain: 0.06 });
  }
  victory() {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) =>
      this.tone(f, i === 5 ? 0.6 : 0.14, { type: 'triangle', gain: 0.16, delay: i * 0.11 }),
    );
  }
  defeat() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.14, delay: i * 0.18 }));
  }

  /** Rising tension bed for the final duel. */
  startDrone() {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || this.drone) return;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 1.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const oscs = [55, 55.6, 82.4].map((hz) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.connect(f);
      o.start();
      return o;
    });
    f.connect(g).connect(this.musicBus);
    this.drone = {
      stop: () => {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        oscs.forEach((o) => o.stop(t + 0.7));
      },
      setIntensity: (x: number) => {
        f.frequency.setTargetAtTime(300 + x * 1500, ctx.currentTime, 0.2);
        oscs.forEach((o, i) => o.frequency.setTargetAtTime([55, 55.6, 82.4][i] * (1 + x * 0.5), ctx.currentTime, 0.3));
      },
    };
  }
  droneIntensity(x: number) {
    this.drone?.setIntensity(x);
  }
  stopDrone() {
    this.drone?.stop();
    this.drone = null;
  }
}

export const audio = new AudioEngine();
