import { OfflineAudioContext } from "node-web-audio-api";
import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { fft } from "./analysis";
import { clearWarpCache, getWarpedBuffer, WarpError, warpPlan, type WarpParams } from "./warpCache";

const SR = 44100;

function sine(freq: number, seconds: number, channels = 1): AudioBuffer {
  const ctx = new OfflineAudioContext(channels, Math.floor(seconds * SR), SR);
  const buffer = ctx.createBuffer(channels, Math.floor(seconds * SR), SR);
  for (let c = 0; c < channels; c++) {
    const d = buffer.getChannelData(c);
    const f = c === 0 ? freq : freq * 1.5;
    for (let i = 0; i < d.length; i++) d[i] = 0.8 * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return buffer as unknown as AudioBuffer;
}

function dominantHz(buffer: AudioBuffer, channel = 0): number {
  const n = 16384;
  const data = buffer.getChannelData(channel);
  const mid = Math.max(0, Math.floor(data.length / 2 - n / 2));
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = (data[mid + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  let best = 1;
  for (let k = 1; k < n / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
  const a = Math.hypot(re[best - 1], im[best - 1]);
  const b = Math.hypot(re[best], im[best]);
  const c = Math.hypot(re[best + 1], im[best + 1]);
  const shift = (0.5 * (a - c)) / (a - 2 * b + c);
  return ((best + shift) * buffer.sampleRate) / n;
}

const base: WarpParams = { tempoRatio: 1, semitones: 0, cents: 0, keyLock: true };

beforeEach(() => clearWarpCache());

describe("getWarpedBuffer", () => {
  it("returns the source itself for neutral settings", async () => {
    const src = sine(440, 1);
    expect(await getWarpedBuffer(src, base)).toBe(src);
  });

  for (const ratio of [0.5, 0.8, 1.25, 2]) {
    it(`scales duration by 1/${ratio} and keeps the pitch with key lock`, async () => {
      const src = sine(440, 3);
      const out = await getWarpedBuffer(src, { ...base, tempoRatio: ratio });
      expect(out.duration).toBeCloseTo(3 / ratio, 1);
      expect(dominantHz(out)).toBeGreaterThan(436);
      expect(dominantHz(out)).toBeLessThan(444);
    });
  }

  it("moves the pitch with the tempo when key lock is off", async () => {
    const out = await getWarpedBuffer(sine(440, 2), { ...base, tempoRatio: 1.5, keyLock: false });
    expect(out.duration).toBeCloseTo(2 / 1.5, 2);
    expect(dominantHz(out)).toBeGreaterThan(655);
    expect(dominantHz(out)).toBeLessThan(665);
  });

  it("doubles the frequency at +12 semitones without changing the length", async () => {
    const src = sine(440, 2);
    const out = await getWarpedBuffer(src, { ...base, semitones: 12 });
    expect(out.duration).toBeCloseTo(2, 1);
    expect(dominantHz(out)).toBeGreaterThan(875);
    expect(dominantHz(out)).toBeLessThan(885);
  });

  it("applies cents on top of semitones", async () => {
    const out = await getWarpedBuffer(sine(440, 2), { ...base, semitones: -12, cents: 50 });
    const expected = 220 * 2 ** (50 / 1200);
    expect(Math.abs(dominantHz(out) - expected)).toBeLessThan(3);
  });

  it("keeps the two channels independent", async () => {
    const out = await getWarpedBuffer(sine(300, 2, 2), { ...base, tempoRatio: 0.75 });
    expect(out.numberOfChannels).toBe(2);
    expect(Math.abs(dominantHz(out, 0) - 300)).toBeLessThan(4);
    expect(Math.abs(dominantHz(out, 1) - 450)).toBeLessThan(5);
  });

  it("never clips past full scale and leaves no jumps at grain joins", async () => {
    const out = await getWarpedBuffer(sine(220, 2), { ...base, tempoRatio: 1.4, semitones: 3 });
    const d = out.getChannelData(0);
    let peak = 0;
    let maxStep = 0;
    for (let i = 1; i < d.length; i++) {
      peak = Math.max(peak, Math.abs(d[i]));
      maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1]));
    }
    expect(peak).toBeLessThanOrEqual(1.001);
    // A 220 Hz sine at amplitude 0.8 moves at most about 0.03 per sample; a click would be much larger.
    expect(maxStep).toBeLessThan(0.08);
  });

  it("caches by source and settings", async () => {
    const src = sine(440, 1);
    const a = getWarpedBuffer(src, { ...base, semitones: 2 });
    const b = getWarpedBuffer(src, { ...base, semitones: 2 });
    expect(await a).toBe(await b);
    expect(await getWarpedBuffer(src, { ...base, semitones: 3 })).not.toBe(await a);
  });

  it("rejects ratios it cannot honour", async () => {
    await expect(getWarpedBuffer(sine(440, 0.5), { ...base, tempoRatio: 0 })).rejects.toBeInstanceOf(WarpError);
    await expect(getWarpedBuffer(sine(440, 0.5), { ...base, tempoRatio: 9 })).rejects.toBeInstanceOf(WarpError);
  });
});

describe("warpPlan", () => {
  it("keeps duration independent of pitch and pitch independent of tempo under key lock", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.25, max: 4, noNaN: true }), fc.integer({ min: -12, max: 12 }), fc.integer({ min: -50, max: 50 }), (r, st, ct) => {
        const locked = warpPlan({ tempoRatio: r, semitones: st, cents: ct, keyLock: true });
        expect(locked.durationScale).toBeCloseTo(1 / r, 9);
        expect(locked.pitch).toBeCloseTo(2 ** ((st + ct / 100) / 12), 9);
        const free = warpPlan({ tempoRatio: r, semitones: st, cents: ct, keyLock: false });
        expect(free.pitch).toBeCloseTo(locked.pitch * r, 9);
      }),
    );
  });
});
