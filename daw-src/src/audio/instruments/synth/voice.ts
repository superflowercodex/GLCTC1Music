import { noiseBuffer, PULSE_CURVE, saturationCurve } from "./curves";
import { scheduleAdsr, type Adsr } from "./envelope";
import type { ModBus } from "./modbus";

export type WaveName = "sine" | "sawtooth" | "square" | "triangle" | "pulse";
export type ModDest = "pitch" | "cut" | "res" | "pw" | "amp" | "pan" | "o2" | "x";

export interface OscSpec {
  wave: WaveName;
  /** Frequency multiplier against the note, e.g. 0.5 for an octave down. */
  ratio: number;
  cents: number;
  level: number;
  /** Pulse width 0..1; only used when wave is "pulse". */
  pw: number;
}

/** One unison lane: oscillator A, an optional oscillator B that can FM or ring-modulate A, and a stereo position. */
export interface LaneSpec {
  a: OscSpec;
  b?: OscSpec;
  pan: number;
}

export interface ModRoute {
  /** An LFO output, the wheel, or "env" for the filter envelope. */
  src: AudioNode | "env";
  dest: ModDest;
  /** In the destination's native unit: cents for pitch, cut and o2; dB for res; fraction for pw, amp, pan; ratio for x. */
  amount: number;
  /** Seconds before the source fades in (LFO delay). */
  fade?: number;
  /** Multiplies the source by this signal, so the wheel can scale vibrato depth. */
  scaleBy?: AudioNode;
}

export interface FilterSpec {
  type: "lowpass" | "bandpass" | "highpass";
  cutoff: number;
  /** Biquad Q in dB. */
  q: number;
  /** 1 for 12 dB/oct, 2 for 24 dB/oct. */
  poles: 1 | 2;
  /** Static offset: key tracking, velocity, p-locks. */
  offsetCents: number;
  /** How far the filter envelope opens the cutoff, in cents (negative closes it). */
  envCents: number;
  /** High-pass corner in Hz before the filter; 0 for none. */
  hp: number;
  drive: number;
}

export interface VoiceSpec {
  freq: number;
  /** Where a glide starts from, in Hz. */
  fromFreq: number | null;
  /** Portamento time in seconds. */
  glide: number;
  lanes: readonly LaneSpec[];
  xmod: number;
  ring: number;
  sub: { wave: "sine" | "square" | "triangle"; level: number; ratio: number } | null;
  noise: { level: number; pink: boolean } | null;
  sample: { buffer: AudioBuffer; rate: number; level: number } | null;
  filter: FilterSpec;
  ampEnv: Adsr;
  filterEnv: Adsr;
  peak: number;
  pan: number;
  pitchEnvCents: number;
  bendRange: number;
  /** Mod wheel to cutoff, cents at full wheel. */
  wheelCutCents: number;
  routes: readonly ModRoute[];
}

interface FreqTarget {
  param: AudioParam;
  ratio: number;
}

/**
 * One note. Every node is created here and disconnected when the note's tail ends, so a long session
 * never accumulates graph. `end` is the audio time after which the voice is gone.
 */
export class SynthVoice {
  readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly freqTargets: FreqTarget[] = [];
  private readonly ampEnv: ReturnType<typeof scheduleAdsr>;
  private readonly filterEnv: ReturnType<typeof scheduleAdsr>;

  released = false;
  dead = false;
  /** When the release begins, once known; a second release after that moment would restart the envelope. */
  releaseTime: number | null = null;
  end: number | null = null;
  midi: number;
  freq: number;
  /** Whoever created the voice can tag it, e.g. to silence sequenced notes when the pattern is switched off. */
  sequenced = false;
  /** Free for the owner to group voices, e.g. by patch. */
  tag = 0;
  private readonly filterNodes: BiquadFilterNode[] = [];
  private highpass: BiquadFilterNode | null = null;
  onEnd?: () => void;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    bus: ModBus,
    spec: VoiceSpec,
    midi: number,
    readonly startTime: number,
    duration: number | null,
  ) {
    this.midi = midi;
    this.freq = spec.freq;
    const t0 = startTime;
    const node = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    const source = <T extends AudioScheduledSourceNode>(n: T): T => {
      this.sources.push(n);
      return node(n);
    };
    const f = spec.filter;

    const vca = node(ctx.createGain());
    const trem = node(ctx.createGain());
    const pan = node(ctx.createStereoPanner());
    const mix = node(ctx.createGain());
    vca.gain.value = 0;
    trem.gain.value = 1;
    pan.pan.value = Math.max(-1, Math.min(1, spec.pan));

    // Filter chain: optional high-pass, one or two low/band/high-pass poles, optional drive.
    const filters: BiquadFilterNode[] = [];
    const hp = f.hp > 25 ? node(ctx.createBiquadFilter()) : null;
    if (hp) {
      hp.type = "highpass";
      hp.frequency.value = f.hp;
      hp.Q.value = -3;
    }
    for (let i = 0; i < f.poles; i++) {
      const bq = node(ctx.createBiquadFilter());
      bq.type = f.type;
      bq.frequency.value = Math.max(20, Math.min(20000, f.cutoff));
      bq.detune.value = f.offsetCents;
      // Only the last pole carries the resonance; stacking it would make 24 dB filters ring far harder than 12 dB ones.
      bq.Q.value = i === f.poles - 1 ? f.q : Math.min(f.q, 0) - 1;
      filters.push(bq);
    }
    const last = filters[filters.length - 1];
    this.filterNodes.push(...filters);
    this.highpass = hp;
    mix.connect(hp ?? filters[0]);
    if (hp) hp.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    let tail: AudioNode = last;
    if (f.drive > 0.02) {
      const ws = node(ctx.createWaveShaper());
      ws.curve = saturationCurve(f.drive, 0);
      ws.oversample = "2x";
      last.connect(ws);
      tail = ws;
    }
    tail.connect(vca);
    vca.connect(trem);
    trem.connect(pan);
    pan.connect(dest);

    // Modulation destinations.
    const targets: Record<ModDest, AudioParam[]> = { pitch: [], cut: filters.map((b) => b.detune), res: [last.Q], pw: [], amp: [trem.gain], pan: [pan.pan], o2: [], x: [] };

    const startFreq = spec.fromFreq ?? spec.freq;
    const glides = spec.fromFreq !== null && spec.glide > 0;
    const tuneFreq = (param: AudioParam, ratio: number) => {
      if (glides) {
        param.setValueAtTime(startFreq * ratio, t0);
        param.setTargetAtTime(spec.freq * ratio, t0, Math.max(0.002, spec.glide / 3));
      } else {
        param.value = spec.freq * ratio;
      }
      this.freqTargets.push({ param, ratio });
    };

    const makePulse = (osc: OscillatorNode, pw: number): AudioNode => {
      const sum = node(ctx.createGain());
      const shaper = node(ctx.createWaveShaper());
      const offset = source(ctx.createConstantSource());
      offset.offset.value = 2 * pw - 1;
      shaper.curve = PULSE_CURVE;
      shaper.oversample = "2x";
      osc.connect(sum);
      offset.connect(sum);
      sum.connect(shaper);
      targets.pw.push(offset.offset);
      return shaper;
    };
    const makeOsc = (o: OscSpec, isB: boolean): { osc: OscillatorNode; out: AudioNode } => {
      const osc = source(ctx.createOscillator());
      osc.type = o.wave === "pulse" ? "sawtooth" : o.wave;
      tuneFreq(osc.frequency, o.ratio);
      osc.detune.value = o.cents;
      targets.pitch.push(osc.detune);
      if (isB) targets.o2.push(osc.detune);
      return { osc, out: o.wave === "pulse" ? makePulse(osc, o.pw) : osc };
    };

    const norm = 0.42 / Math.sqrt(Math.max(1, spec.lanes.length));
    let firstA: { out: AudioNode; osc: OscillatorNode } | null = null;
    let firstB: { out: AudioNode; osc: OscillatorNode } | null = null;
    for (const lane of spec.lanes) {
      const panner = node(ctx.createStereoPanner());
      panner.pan.value = Math.max(-1, Math.min(1, lane.pan));
      panner.connect(mix);
      const a = makeOsc(lane.a, false);
      const ga = node(ctx.createGain());
      ga.gain.value = lane.a.level * norm;
      a.out.connect(ga).connect(panner);
      firstA ??= a;
      if (lane.b) {
        const b = makeOsc(lane.b, true);
        firstB ??= b;
        if (lane.b.level > 0.001) {
          const gb = node(ctx.createGain());
          gb.gain.value = lane.b.level * norm;
          b.out.connect(gb).connect(panner);
        }
        if (spec.xmod > 0.001) {
          const xg = node(ctx.createGain());
          xg.gain.value = spec.xmod * spec.freq * lane.a.ratio * 1.6;
          b.out.connect(xg).connect(a.osc.frequency);
          targets.x.push(xg.gain);
        }
      }
    }
    if (spec.ring > 0.001 && firstA && firstB) {
      const product = node(ctx.createGain());
      const ringLevel = node(ctx.createGain());
      product.gain.value = 0;
      firstA.out.connect(product);
      firstB.out.connect(product.gain);
      ringLevel.gain.value = spec.ring * 1.1;
      product.connect(ringLevel).connect(mix);
    }

    if (spec.sub && spec.sub.level > 0.001) {
      const sub = source(ctx.createOscillator());
      sub.type = spec.sub.wave;
      tuneFreq(sub.frequency, spec.sub.ratio);
      targets.pitch.push(sub.detune);
      const g = node(ctx.createGain());
      g.gain.value = spec.sub.level;
      sub.connect(g).connect(mix);
    }
    if (spec.noise && spec.noise.level > 0.001) {
      const n = source(ctx.createBufferSource());
      n.buffer = noiseBuffer(ctx, spec.noise.pink);
      n.loop = true;
      const g = node(ctx.createGain());
      g.gain.value = spec.noise.level;
      n.connect(g).connect(mix);
    }
    if (spec.sample && spec.sample.level > 0.001) {
      const s = source(ctx.createBufferSource());
      s.buffer = spec.sample.buffer;
      s.playbackRate.value = spec.sample.rate;
      const g = node(ctx.createGain());
      g.gain.value = spec.sample.level;
      s.connect(g).connect(mix);
    }

    // Envelopes: a constant source follows the filter envelope (0..1) and fans out to cutoff, pitch and the matrix.
    const releaseAt = duration === null ? null : t0 + duration;
    this.releaseTime = releaseAt;
    this.released = duration !== null;
    const env = source(ctx.createConstantSource());
    env.offset.value = 0;
    this.filterEnv = scheduleAdsr(env.offset, t0, spec.filterEnv, 1, 0, releaseAt);
    this.ampEnv = scheduleAdsr(vca.gain, t0, spec.ampEnv, Math.max(0.0002, spec.peak), 0, releaseAt);
    if (Math.abs(f.envCents) > 1) {
      const g = node(ctx.createGain());
      g.gain.value = f.envCents;
      env.connect(g);
      for (const p of targets.cut) g.connect(p);
    }

    // Pitch bus: bend, tape dive, envelope-to-pitch and any pitch routes land here.
    const pitchBus = node(ctx.createGain());
    for (const p of targets.pitch) pitchBus.connect(p);
    const bendGain = node(ctx.createGain());
    bendGain.gain.value = Math.max(1, spec.bendRange) * 100;
    bus.bend.connect(bendGain).connect(pitchBus);
    bus.tape.connect(pitchBus);
    if (Math.abs(spec.pitchEnvCents) > 1) {
      const g = node(ctx.createGain());
      g.gain.value = spec.pitchEnvCents;
      env.connect(g).connect(pitchBus);
    }

    // Cutoff bus: global offset (macros, freeze), wheel, and cutoff routes.
    const cutBus = node(ctx.createGain());
    for (const p of targets.cut) cutBus.connect(p);
    bus.cutoff.connect(cutBus);
    if (spec.wheelCutCents > 1) {
      const g = node(ctx.createGain());
      g.gain.value = spec.wheelCutCents;
      bus.wheel.connect(g).connect(cutBus);
    }

    const dests = new Map<ModDest, GainNode>();
    const destBus = (d: ModDest): GainNode | null => {
      if (d === "pitch") return pitchBus;
      if (d === "cut") return cutBus;
      let b = dests.get(d);
      if (!b) {
        if (targets[d].length === 0) return null;
        b = node(ctx.createGain());
        for (const p of targets[d]) b.connect(p);
        dests.set(d, b);
      }
      return b;
    };
    for (const route of spec.routes) {
      const bus_ = destBus(route.dest);
      if (!bus_ || Math.abs(route.amount) < 0.0005) continue;
      const src = route.src === "env" ? env : route.src;
      const g = node(ctx.createGain());
      if (route.scaleBy) {
        g.gain.value = 0;
        const k = node(ctx.createGain());
        k.gain.value = route.amount;
        route.scaleBy.connect(k).connect(g.gain);
      } else if (route.fade && route.fade > 0) {
        g.gain.setValueAtTime(0, t0);
        g.gain.setValueAtTime(0, t0 + route.fade);
        g.gain.linearRampToValueAtTime(route.amount, t0 + route.fade + 0.3);
      } else {
        g.gain.value = route.amount;
      }
      src.connect(g).connect(bus_);
    }

    for (const s of this.sources) s.start(t0);
    if (duration !== null) this.finish(this.ampEnv.tailEnd(releaseAt as number));
  }

  /** Lets go of the note at `time` and frees it after the release tail. */
  release(time: number): void {
    if (this.released || this.dead) return;
    this.released = true;
    const t = Math.max(time, this.startTime, this.ctx.currentTime);
    this.releaseTime = t;
    this.ampEnv.release(t);
    this.filterEnv.release(t);
    this.finish(this.ampEnv.tailEnd(t));
  }

  /** Fast fade-out for voice stealing and panic. */
  kill(time = this.ctx.currentTime): void {
    if (this.dead) return;
    this.dead = true;
    const t = Math.max(time, this.startTime, this.ctx.currentTime);
    // Already fading out: restarting the release from the closed-form level would jump the gain back up.
    if (this.releaseTime !== null && this.releaseTime <= t) return;
    this.released = true;
    this.releaseTime = t;
    const r = 0.03;
    this.ampEnv.release(t, r);
    this.finish(this.ampEnv.tailEnd(t, r));
  }

  /** Moves a held note to a new pitch (legato and mono hand-over). */
  setNote(midi: number, freq: number, glideTime: number, when = this.ctx.currentTime): void {
    this.midi = midi;
    this.freq = freq;
    const t = Math.max(when, this.ctx.currentTime);
    for (const { param, ratio } of this.freqTargets) {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(freq * ratio, t, Math.max(0.002, glideTime / 3));
    }
  }

  /** Moves the filter of a note that is already sounding, so cutoff and resonance knobs reach held pads. */
  liveFilter(cutoff: number, q: number, hp: number): void {
    const t = this.ctx.currentTime;
    const c = Math.max(20, Math.min(20000, cutoff));
    for (const f of this.filterNodes) f.frequency.setTargetAtTime(c, t, 0.02);
    this.filterNodes[this.filterNodes.length - 1]?.Q.setTargetAtTime(q, t, 0.02);
    if (this.highpass && hp > 25) this.highpass.frequency.setTargetAtTime(hp, t, 0.02);
  }

  sounding(time: number): boolean {
    return !this.dead && (this.end === null || this.end > time);
  }

  private finish(end: number): void {
    if (this.end !== null && this.end <= end) return;
    this.end = end;
    for (const s of this.sources) {
      try {
        s.stop(end);
      } catch {
        // A source scheduled twice has already been given its stop time.
      }
    }
    const lead = this.sources[0];
    if (lead) {
      lead.onended = () => {
        for (const n of this.nodes) n.disconnect();
        this.onEnd?.();
      };
    }
  }
}
