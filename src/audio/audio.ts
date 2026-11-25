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
}

export const audio = new AudioEngine();
