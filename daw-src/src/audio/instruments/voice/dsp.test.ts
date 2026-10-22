import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { speedToSeconds, tuneBuffer, tuneRatio } from "./autotune";
import { GranularShifter, workletSource } from "./granular";
import { harmonyRatio, semitoneRatio } from "./harmony";
import { freqToMidi, midiToFreq, parseKey, SCALES, scaleNotes, shiftByDegrees, snapToScale, type KeySignature } from "./scales";
import { detectPitch } from "./yin";

const SR = 44100;

function sine(freq: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

function harmonic(f0: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  // A weak fundamental with strong upper partials is how many real voices look to a detector.
  const amps = [0.15, 0.5, 0.4, 0.3, 0.25, 0.2, 0.1];
  amps.forEach((a, k) => {
    for (let i = 0; i < out.length; i++) out[i] += a * Math.sin((2 * Math.PI * f0 * (k + 1) * i) / SR);
  });
  return out;
}

/** Strongest frequency in a range, by scanning a DFT bin every 0.5 Hz. Granular shifting leaves sidebands that confuse a period detector but not the spectral peak. */
function dominant(buf: Float32Array, lo: number, hi: number): number {
  let best = lo;
  let bestPower = 0;
  for (let f = lo; f <= hi; f += 0.5) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = (2 * Math.PI * f * i) / SR;
      re += buf[i] * Math.cos(a);
      im += buf[i] * Math.sin(a);
    }
    const power = re * re + im * im;
    if (power > bestPower) {
      bestPower = power;
      best = f;
    }
  }
  return best;
}

const cents = (a: number, b: number) => Math.abs(1200 * Math.log2(a / b));

describe("YIN pitch detection", () => {
  it.each([110, 220, 440])("detects a %d Hz sine within 3 cents", (freq) => {
    const found = detectPitch(sine(freq, 0.1).subarray(0, 2048), SR);
    expect(found).not.toBeNull();
    expect(cents(found!.freq, freq)).toBeLessThan(3);
    expect(found!.clarity).toBeGreaterThan(0.9);
  });

  it("finds the fundamental of a harmonic-rich tone with a weak fundamental", () => {
    const found = detectPitch(harmonic(165, 0.1).subarray(0, 2048), SR);
    expect(found).not.toBeNull();
    expect(cents(found!.freq, 165)).toBeLessThan(8);
  });

  it("reports nothing for silence", () => {
    expect(detectPitch(new Float32Array(2048), SR)).toBeNull();
  });

  it("holds its accuracy across the vocal range", () => {
    fc.assert(
      fc.property(fc.double({ min: 90, max: 900, noNaN: true }), (freq) => {
        const found = detectPitch(sine(freq, 0.1).subarray(0, 2048), SR);
        return found !== null && cents(found.freq, freq) < 10;
      }),
      { numRuns: 40 },
    );
  });
});

describe("keys and scale snapping", () => {
  it("reads project key strings", () => {
    expect(parseKey("F♯ minor")).toEqual({ root: 6, scale: "minor" });
    expect(parseKey("Bb major")).toEqual({ root: 10, scale: "major" });
    expect(parseKey("C")).toEqual({ root: 0, scale: "major" });
    expect(parseKey("gibberish")).toEqual({ root: 0, scale: "major" });
  });

  it("always snaps to a note of the scale, no further than the widest gap", () => {
    const scaleNames = Object.keys(SCALES);
    fc.assert(
      fc.property(fc.double({ min: 36, max: 96, noNaN: true }), fc.integer({ min: 0, max: 11 }), fc.constantFrom(...scaleNames), (midi, root, scale) => {
        const key: KeySignature = { root, scale };
        const snapped = snapToScale(midi, key);
        const inScale = SCALES[scale].includes((((snapped - root) % 12) + 12) % 12);
        return inScale && Number.isInteger(snapped) && Math.abs(snapped - midi) <= 3;
      }),
    );
  });

  it("leaves a note already in the scale where it is", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 11 }), fc.constantFrom(...Object.keys(SCALES)), (root, scale) => {
        const key: KeySignature = { root, scale };
        return scaleNotes(key, 40, 90).every((n) => snapToScale(n, key) === n);
      }),
    );
  });

  it("moves by scale degrees inside the key", () => {
    const key: KeySignature = { root: 0, scale: "major" };
    expect(shiftByDegrees(60, 2, key)).toBe(64);
    expect(shiftByDegrees(60, -1, key)).toBe(59);
    expect(shiftByDegrees(60, 7, key)).toBe(72);
  });
});

describe("auto-tune", () => {
  const cMajor: KeySignature = { root: 0, scale: "major" };

  it("pulls a flat or sharp voice toward the nearest scale note", () => {
    fc.assert(
      fc.property(fc.double({ min: 150, max: 600, noNaN: true }), (freq) => {
        const target = midiToFreq(snapToScale(freqToMidi(freq), cMajor));
        const corrected = freq * tuneRatio(freq, { key: cMajor, amount: 1, humanise: 0 });
        return Math.abs(corrected - target) <= Math.abs(freq - target) + 1e-6;
      }),
    );
  });

  it("does nothing at zero amount", () => {
    expect(tuneRatio(452, { key: cMajor, amount: 0, humanise: 0 })).toBeCloseTo(1, 9);
  });

  it("maps speed to a faster glide when the knob goes up", () => {
    expect(speedToSeconds(1)).toBeLessThan(speedToSeconds(0.5));
    expect(speedToSeconds(0.5)).toBeLessThan(speedToSeconds(0));
  });

  it("retunes a detuned held note when run over a whole buffer", () => {
    const sung = 440 * 2 ** (35 / 1200);
    const out = tuneBuffer(sine(sung, 1.5), SR, { key: cMajor, amount: 1, humanise: 0, speed: 1 });
    const tail = out.subarray(out.length - 4096, out.length - 2048);
    const found = detectPitch(tail, SR);
    expect(found).not.toBeNull();
    expect(cents(found!.freq, 440)).toBeLessThan(cents(sung, 440));
    expect(cents(found!.freq, 440)).toBeLessThan(15);
  });
});

describe("harmoniser", () => {
  const key: KeySignature = { root: 0, scale: "major" };

  it("uses exact semitone ratios in interval mode", () => {
    expect(harmonyRatio(220, 12, "interval", key)).toBeCloseTo(2, 9);
    expect(harmonyRatio(220, -12, "interval", key)).toBeCloseTo(0.5, 9);
    expect(harmonyRatio(220, 7, "interval", key)).toBeCloseTo(semitoneRatio(7), 9);
    expect(harmonyRatio(220, 0, "interval", key)).toBe(1);
  });

  it("lands on a scale note in scale mode", () => {
    fc.assert(
      fc.property(fc.integer({ min: 48, max: 84 }), fc.integer({ min: -12, max: 12 }), (note, interval) => {
        const freq = midiToFreq(note);
        const heard = freqToMidi(freq * harmonyRatio(freq, interval, "scale", key));
        const nearest = snapToScale(heard, key);
        return Math.abs(heard - nearest) < 1e-6;
      }),
    );
  });
});

describe("granular shifter", () => {
  function shiftSine(freq: number, ratio: number, known = true): number {
    const shifter = new GranularShifter(1440);
    const input = sine(freq, 1);
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 128) shifter.process(input.subarray(i, i + 128), output.subarray(i, i + 128), ratio, known ? SR / freq : 0);
    return dominant(output.subarray(SR / 2, SR / 2 + 8192), 80, 700);
  }

  it.each([0.5, 0.75, 1.5, 2])("shifts a 220 Hz tone by ratio %s", (ratio) => {
    expect(cents(shiftSine(220, ratio), 220 * ratio)).toBeLessThan(20);
  });

  it("keeps its output bounded", () => {
    const shifter = new GranularShifter(1440);
    const input = sine(300, 0.5, 0.9);
    const output = new Float32Array(input.length);
    shifter.process(input, output, 1.7);
    expect(Math.max(...output.map(Math.abs))).toBeLessThan(1.2);
  });

  it("builds a worklet module that runs the same algorithm", () => {
    let Registered: (new () => { process(i: Float32Array[][], o: Float32Array[][], p: Record<string, Float32Array>): boolean }) | undefined;
    const factory = new Function("AudioWorkletProcessor", "registerProcessor", `${workletSource()}`);
    factory(class {}, (_name: string, ctor: typeof Registered) => (Registered = ctor));
    expect(Registered).toBeDefined();
    const node = new Registered!();
    const input = sine(220, 1);
    const result = new Float32Array(input.length);
    for (let i = 0; i + 128 <= input.length; i += 128) {
      const out = new Float32Array(128);
      node.process([[input.subarray(i, i + 128)]], [[out]], { ratio: new Float32Array([1.5]), period: new Float32Array([SR / 220]) });
      result.set(out, i);
    }
    expect(cents(dominant(result.subarray(SR / 2, SR / 2 + 8192), 80, 700), 330)).toBeLessThan(20);
  });
});
