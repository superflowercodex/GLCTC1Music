import { noiseBuffer } from "./noise";
import { satCurve } from "./curves";

const METAL_PARTIALS = [205.3, 304.4, 369.6, 522.7, 540, 800];

/**
 * One struck drum sound. Every source it starts is stopped on a schedule and disconnects itself
 * when it ends, so a dense pattern never leaves nodes behind.
 */
export class Hit {
  readonly out: GainNode;
  private readonly velocity: number;
  private pending = 0;
  private extra: AudioNode[] = [];
  private done: (() => void) | undefined;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly t: number,
    velocity: number,
    dest: AudioNode,
    readonly rng: () => number,
    onDone: (hit: Hit) => void,
  ) {
    this.velocity = velocity;
    this.out = ctx.createGain();
    this.out.gain.value = velocity;
    this.out.connect(dest);
    this.done = () => {
      this.release();
      this.out.disconnect();
      onDone(this);
    };
  }

  /** Fades the hit out quickly; used when playback stops so tails do not ring on. */
  choke(at: number, tau = 0.006): void {
    // An explicit starting value keeps engines that evaluate a lone setTarget event differently consistent.
    this.out.gain.cancelScheduledValues(at);
    this.out.gain.setValueAtTime(this.velocity, at);
    this.out.gain.setTargetAtTime(0, at, tau);
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    this.pending += 1;
    source.onended = () => {
      source.disconnect();
      for (const n of nodes) n.disconnect();
      this.pending -= 1;
      if (this.pending === 0) this.done?.();
    };
  }

  /** Oscillator with a click-free attack, an exponential decay and an optional fast pitch glide. */
  osc(freq: number, wave: OscillatorType, dur: number, amp: number, endFreq?: number, tau?: number, att = 0.001, dest: AudioNode = this.out, detune = 0): GainNode {
    const { ctx, t } = this;
    const o = ctx.createOscillator();
    const a = ctx.createGain();
    o.type = wave;
    o.detune.value = detune;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (endFreq !== undefined) o.frequency.setTargetAtTime(Math.max(20, endFreq), t, tau ?? dur * 0.25);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + att);
    a.gain.exponentialRampToValueAtTime(0.0001, t + att + dur);
    o.connect(a);
    a.connect(dest);
    o.start(t);
    o.stop(t + att + dur + 0.03);
    this.track(o, [a]);
    return a;
  }

  /** Filtered noise burst; each hit starts at a different point in the shared noise so repeats are not identical. */
  noise(dur: number, amp: number, type: BiquadFilterType = "highpass", freq = 5000, off = 0, q = 0.7, att = 0.0008, dest: AudioNode = this.out): GainNode {
    const { ctx, t } = this;
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const a = ctx.createGain();
    s.buffer = noiseBuffer(ctx);
    f.type = type;
    f.frequency.value = Math.min(freq, ctx.sampleRate * 0.45);
    f.Q.value = q;
    a.gain.setValueAtTime(0.0001, t + off);
    a.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + off + att);
    a.gain.exponentialRampToValueAtTime(0.0001, t + off + att + dur);
    s.connect(f);
    f.connect(a);
    a.connect(dest);
    s.start(t + off, this.rng() * 1.5, dur + att + 0.03);
    this.track(s, [f, a]);
    return a;
  }

  /** Six inharmonic square waves through band-pass and high-pass: the classic metallic hat and cymbal core. */
  metal(dur: number, amp: number, hp: number, bp: number, scale = 1, att = 0.001, q = 0.9, dest: AudioNode = this.out): GainNode {
    const { ctx, t } = this;
    const pre = ctx.createGain();
    const bpf = ctx.createBiquadFilter();
    const hpf = ctx.createBiquadFilter();
    const a = ctx.createGain();
    pre.gain.value = 0.17;
    const hum = 1 + (this.rng() - 0.5) * 0.01;
    const oscs = METAL_PARTIALS.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f * scale * hum * (1 + i * 0.0007);
      o.connect(pre);
      o.start(t);
      o.stop(t + att + dur + 0.03);
      return o;
    });
    bpf.type = "bandpass";
    bpf.frequency.value = Math.min(bp, ctx.sampleRate * 0.45);
    bpf.Q.value = q;
    hpf.type = "highpass";
    hpf.frequency.value = Math.min(hp, ctx.sampleRate * 0.45);
    hpf.Q.value = 0.7;
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(amp, t + att);
    a.gain.exponentialRampToValueAtTime(0.0001, t + att + dur);
    pre.connect(bpf);
    bpf.connect(hpf);
    hpf.connect(a);
    a.connect(dest);
    oscs.forEach((o, i) => this.track(o, i === 0 ? [pre, bpf, hpf, a] : []));
    return a;
  }


  /** Oscillator through a low-pass whose cutoff glides from `fc0` to `fc1`: plucks, stabs, pads and leads. */
  filtOsc(wave: OscillatorType, freq: number, dur: number, amp: number, fc0: number, fc1: number, q = 1, att = 0.003, detune = 0): GainNode {
    const { ctx, t } = this;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const a = ctx.createGain();
    o.type = wave;
    o.frequency.value = freq;
    o.detune.value = detune;
    f.type = "lowpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(fc0, t);
    f.frequency.setTargetAtTime(fc1, t, dur * 0.3);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + att);
    a.gain.exponentialRampToValueAtTime(0.0001, t + att + dur);
    o.connect(f);
    f.connect(a);
    a.connect(this.out);
    o.start(t);
    o.stop(t + att + dur + 0.04);
    this.track(o, [f, a]);
    return a;
  }

  /** Band-passed noise whose centre sweeps upward: risers. */
  sweep(dur: number, peak: number, fromHz: number, toHz: number, q = 2.2): void {
    const { ctx, t } = this;
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const a = ctx.createGain();
    s.buffer = noiseBuffer(ctx);
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(fromHz, t);
    f.frequency.exponentialRampToValueAtTime(toHz, t + dur);
    a.gain.setValueAtTime(0.0002, t);
    a.gain.exponentialRampToValueAtTime(Math.max(0.0003, peak), t + dur);
    a.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    s.connect(f);
    f.connect(a);
    a.connect(this.out);
    s.start(t, this.rng() * 1.2, dur + 0.1);
    this.track(s, [f, a]);
  }

  /** A soft-clipping stage whose input the caller feeds; the result lands on the hit output. */
  saturator(k: number, gain = 0.85): GainNode {
    const { ctx } = this;
    const input = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const post = ctx.createGain();
    shaper.curve = satCurve(k);
    shaper.oversample = "2x";
    post.gain.value = gain;
    input.connect(shaper);
    shaper.connect(post);
    post.connect(this.out);
    // These nodes have no source of their own, so the oscillator that ends last releases them.
    this.extra.push(input, shaper, post);
    return input;
  }

  /** Plays a decoded sample once and releases everything when it ends. */
  buffer(buf: AudioBuffer, rate = 1, gain = 1, maxDur?: number): void {
    const { ctx, t } = this;
    const s = ctx.createBufferSource();
    const g = ctx.createGain();
    s.buffer = buf;
    s.playbackRate.value = rate;
    g.gain.value = gain;
    s.connect(g);
    g.connect(this.out);
    s.start(t);
    if (maxDur !== undefined) s.stop(t + maxDur);
    this.track(s, [g]);
  }

  private release(): void {
    for (const n of this.extra) n.disconnect();
    this.extra = [];
  }
}
