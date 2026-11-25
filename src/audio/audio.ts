/**
 * Game audio: recorded CC0 sound effects (Kenney audio packs, see public/audio/CREDITS.md), played through WebAudio.
 * Each sound has a few takes; every play picks one at random and nudges its pitch and level, so repeats never sound
 * identical. Under a round, a distant boat engine idles and revs as the fuse runs down.
 */
import { getSettings } from '../state/settings';

const base = `${import.meta.env.BASE_URL}audio/`;

/** Sound name → its takes (files in public/audio, without .ogg). */
const BANK = {
  tick: ['tick_001', 'tick_002', 'tick_004'],
  count: ['select_001', 'select_002'],
  go: ['bong_001'],
  punch: ['impactPunch_medium_000', 'impactPunch_medium_001', 'impactPunch_medium_002'],
  knock: ['impactWood_light_000', 'impactWood_light_001'],
  swish: ['cloth1', 'cloth2', 'cloth3', 'cloth4'],
  thud: ['impactWood_heavy_000', 'impactWood_heavy_001', 'impactPlank_medium_000'],
  blast: ['explosionCrunch_000', 'explosionCrunch_001', 'explosionCrunch_002'],
  boom: ['lowFrequency_explosion_000', 'lowFrequency_explosion_001'],
  coins: ['handleCoins', 'handleCoins2'],
  reveal: ['maximize_006', 'confirmation_002'],
  magic: ['glass_002', 'glass_004'],
  ding: ['impactBell_heavy_000'],
  shield: ['forceField_000', 'forceField_001'],
  reset: ['switch_002'],
  error: ['error_004'],
  win: ['jingles_STEEL00'],
  lose: ['jingles_SAX03'],
  engine: ['engineCircular_000'],
} as const;
type SoundName = keyof typeof BANK;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = false;
  private engine: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

  /** Must be called from a user gesture before sound can play. Loads the bank the first time. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      // a gentle limiter so a big blast on top of a punch never clips
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
      this.sfxBus.connect(comp);
      this.musicBus.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.applyVolumes();
    void this.load();
    this.applyWeather(); // a weather that started before the first click
  }

  private async load() {
    if (this.loading || !this.ctx) return;
    this.loading = true;
    const ctx = this.ctx;
    const files = [...new Set(Object.values(BANK).flat())];
    await Promise.all(
      files.map(async (f) => {
        try {
          const res = await fetch(`${base}${f}.ogg`);
          this.buffers.set(f, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* a missing take just isn't played */
        }
      }),
    );
  }

  applyVolumes() {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return;
    const s = getSettings();
    this.sfxBus.gain.value = s.master * s.sfx;
    this.musicBus.gain.value = s.master * s.music * 0.6;
  }

  /** Play one random take of a sound. rate shifts pitch/speed; jitter adds a little variety. */
  private play(name: SoundName, o: { gain?: number; rate?: number; delay?: number; jitter?: number; bus?: 'sfx' | 'music' } = {}) {
    const ctx = this.ctx;
    const bus = o.bus === 'music' ? this.musicBus : this.sfxBus;
    if (!ctx || !bus) return;
    const takes = BANK[name];
    const buf = this.buffers.get(takes[Math.floor(Math.random() * takes.length)]);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const j = o.jitter ?? 0.06;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * j);
    const g = ctx.createGain();
    g.gain.value = (o.gain ?? 1) * (1 + (Math.random() * 2 - 1) * 0.08);
    src.connect(g).connect(bus);
    src.start(ctx.currentTime + (o.delay ?? 0));
  }

  tick(urgency: number) {
    // urgency 0 (calm) → 1 (about to blow): quicker, higher, louder
    this.play('tick', { gain: 0.35 + urgency * 0.4, rate: 1 + urgency * 0.6, jitter: 0.02 });
  }
  countdown(final: boolean) {
    if (final) this.play('go', { gain: 0.8, jitter: 0 });
    else this.play('count', { gain: 0.6, jitter: 0 });
  }
  transfer() {
    this.play('punch', { gain: 0.9 });
    this.play('knock', { gain: 0.5, delay: 0.02 });
  }
  throwBomb() {
    this.play('swish', { gain: 0.8, rate: 1.15 });
  }
  miss() {
    this.play('thud', { gain: 0.7 });
  }
  explosion() {
    this.play('blast', { gain: 1, jitter: 0.08 });
    this.play('boom', { gain: 0.9, rate: 0.9 });
  }
  dash() {
    this.play('swish', { gain: 0.5, rate: 1.5 });
  }
  pickup() {
    this.play('coins', { gain: 0.8 });
  }
  reveal() {
    this.play('reveal', { gain: 0.6, jitter: 0.02 });
  }
  ability(pitch = 1) {
    this.play('magic', { gain: 0.6, rate: pitch });
  }
  reflect() {
    this.play('ding', { gain: 0.6, rate: 1.4 });
  }
  block() {
    this.play('shield', { gain: 0.7 });
  }
  fuseReset() {
    this.play('reset', { gain: 0.6 });
  }
  denied() {
    this.play('error', { gain: 0.45, jitter: 0 });
  }
  victory() {
    this.play('win', { gain: 0.85, jitter: 0, bus: 'music' });
  }
  defeat() {
    this.play('lose', { gain: 0.85, jitter: 0, bus: 'music' });
  }

  /** Under the round: a distant boat engine idling, revving with the tension. */
  startDrone() {
    const ctx = this.ctx;
    const buf = this.buffers.get(BANK.engine[0]);
    if (!ctx || !this.musicBus || this.engine || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.playbackRate.value = 0.7;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 1.5);
    src.connect(filter).connect(gain).connect(this.musicBus);
    src.start();
    this.engine = { src, gain, filter };
  }
  droneIntensity(x: number) {
    const e = this.engine, ctx = this.ctx;
    if (!e || !ctx) return;
    e.src.playbackRate.setTargetAtTime(0.7 + x * 0.6, ctx.currentTime, 0.3);
    e.filter.frequency.setTargetAtTime(700 + x * 2200, ctx.currentTime, 0.3);
    e.gain.gain.setTargetAtTime(0.22 + x * 0.2, ctx.currentTime, 0.3);
  }
  stopDrone() {
    const e = this.engine, ctx = this.ctx;
    if (!e || !ctx) return;
    const t = ctx.currentTime;
    e.gain.gain.cancelScheduledValues(t);
    e.gain.gain.setValueAtTime(Math.max(0.0001, e.gain.gain.value), t);
    e.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    e.src.stop(t + 0.7);
    this.engine = null;
  }

  // ───────────── weather: synthesized from filtered noise (no extra files), plus the low boom under thunder ─────────────

  private weatherWant: { rain: number; wind: number; gain: number } | null = null;
  private weatherNodes: { out: GainNode; stop: (t: number) => void } | null = null;
  private noiseBuf: { white: AudioBuffer; brown: AudioBuffer } | null = null;

  private noise() {
    const ctx = this.ctx!;
    if (this.noiseBuf) return this.noiseBuf;
    const len = ctx.sampleRate * 3;
    const white = ctx.createBuffer(1, len, ctx.sampleRate), brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    return (this.noiseBuf = { white, brown });
  }

  /** Start the weather's sound bed (rain hiss, wind gusts). Waits for the first click if audio isn't unlocked yet. */
  startWeather(want: { rain: number; wind: number; gain: number }) {
    this.weatherWant = want;
    this.applyWeather();
  }
  stopWeather() {
    this.weatherWant = null;
    const n = this.weatherNodes, ctx = this.ctx;
    this.weatherNodes = null;
    if (!n || !ctx) return;
    const t = ctx.currentTime;
    n.out.gain.cancelScheduledValues(t);
    n.out.gain.setValueAtTime(Math.max(0.0001, n.out.gain.value), t);
    n.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    n.stop(t + 0.9);
  }
  private applyWeather() {
    const ctx = this.ctx, want = this.weatherWant;
    if (!ctx || !this.sfxBus || !want || this.weatherNodes) return;
    const { white } = this.noise();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.exponentialRampToValueAtTime(want.gain, t + 2);
    out.connect(this.sfxBus);
    const stops: AudioScheduledSourceNode[] = [];
    const loop = (offset: number) => {
      const s = ctx.createBufferSource();
      s.buffer = white; s.loop = true; s.start(t, offset);
      stops.push(s);
      return s;
    };
    if (want.rain > 0) {
      // the hiss of rain on concrete, and its softer roar out on the water
      const hi = ctx.createBiquadFilter(); hi.type = 'highpass'; hi.frequency.value = 500;
      const lo = ctx.createBiquadFilter(); lo.type = 'lowpass'; lo.frequency.value = 5200 + want.rain * 1200;
      const g = ctx.createGain(); g.gain.value = 0.16 * Math.min(want.rain, 1.5);
      loop(0).connect(hi).connect(lo).connect(g).connect(out);
      const roar = ctx.createBiquadFilter(); roar.type = 'lowpass'; roar.frequency.value = 700;
      const g2 = ctx.createGain(); g2.gain.value = 0.22 * Math.min(want.rain, 1.5);
      loop(1.3).connect(roar).connect(g2).connect(out);
    }
    if (want.wind >= 0.9) {
      // wind: a band of noise whose pitch and level rise and fall in slow gusts
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = 0.05 * want.wind;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
      const lfoF = ctx.createGain(); lfoF.gain.value = 160;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.03 * want.wind;
      lfo.connect(lfoF).connect(bp.frequency);
      lfo.connect(lfoG).connect(g.gain);
      lfo.start(t);
      stops.push(lfo);
      loop(2.1).connect(bp).connect(g).connect(out);
    }
    this.weatherNodes = { out, stop: (at) => stops.forEach((s) => s.stop(at)) };
  }

  /** Thunder after a lightning flash: `near` 0 (far: late, low, soft) → 1 (close: soon, with a crack). */
  thunder(near: number) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const { brown, white } = this.noise();
    const t = ctx.currentTime + 0.35 + (1 - near) * 2.2;
    const dur = 3.5 + (1 - near) * 2;
    const rumble = ctx.createBufferSource(); rumble.buffer = brown; rumble.playbackRate.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160 + near * 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 + near * 0.6, t + 0.08 + (1 - near) * 0.4);
    g.gain.exponentialRampToValueAtTime(0.25, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    rumble.connect(lp).connect(g).connect(this.sfxBus);
    rumble.start(t, Math.random() * 1.5);
    rumble.stop(t + dur + 0.1);
    if (near > 0.55) {
      // a close strike cracks first
      const crack = ctx.createBufferSource(); crack.buffer = white;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1800; hp.Q.value = 0.6;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.35 * near, t + 0.01);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      crack.connect(hp).connect(cg).connect(this.sfxBus);
      crack.start(t, Math.random());
      crack.stop(t + 0.5);
    }
    this.play('boom', { gain: 0.35 + near * 0.4, rate: 0.42 + near * 0.12, delay: t - ctx.currentTime + 0.05, jitter: 0.05 });
  }
}

export const audio = new AudioEngine();
