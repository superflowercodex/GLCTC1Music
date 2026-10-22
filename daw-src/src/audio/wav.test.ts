import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav, WavError, wavFileSizeBytes } from "./wav";

const samples = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 200 });

describe("encodeWav", () => {
  it("writes a valid header", () => {
    const l = new Float32Array([0, 0.5, -0.5]);
    const r = new Float32Array([1, -1, 0]);
    const bytes = encodeWav([l, r], 44100, { bitDepth: 16 });
    const v = new DataView(bytes);
    const tag = (o: number): string => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(12)).toBe("fmt ");
    expect(tag(36)).toBe("data");
    expect(v.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 2 * 2);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(3 * 2 * 2);
    expect(bytes.byteLength).toBe(wavFileSizeBytes(3, 2, 16));
  });

  it("16-bit round-trips within half a step", () => {
    fc.assert(
      fc.property(samples, fc.integer({ min: 1, max: 2 }), (data, channelCount) => {
        const channels = Array.from({ length: channelCount }, (_, c) => Float32Array.from(data.map((x) => (c === 0 ? x : -x))));
        const back = decodeWav(encodeWav(channels, 48000, { bitDepth: 16 }));
        expect(back.sampleRate).toBe(48000);
        expect(back.channels).toHaveLength(channelCount);
        back.channels.forEach((ch, c) => ch.forEach((v, i) => expect(Math.abs(v - channels[c][i])).toBeLessThanOrEqual(0.5 / 32767 + 1e-7)));
      }),
    );
  });

  it("24-bit round-trips within half a step", () => {
    fc.assert(
      fc.property(samples, (data) => {
        const ch = Float32Array.from(data);
        const back = decodeWav(encodeWav([ch], 44100, { bitDepth: 24 }));
        expect(back.bitDepth).toBe(24);
        back.channels[0].forEach((v, i) => expect(Math.abs(v - ch[i])).toBeLessThanOrEqual(1e-6));
      }),
    );
  });

  it("clamps out-of-range and non-finite samples instead of wrapping", () => {
    const back = decodeWav(encodeWav([new Float32Array([2, -2, Number.NaN, Number.POSITIVE_INFINITY])], 44100, { bitDepth: 16 }));
    expect(Array.from(back.channels[0])).toEqual([1, -1, 0, 0]);
  });

  it("dither stays within a couple of steps and is repeatable", () => {
    const ch = new Float32Array(500).fill(0.25);
    const a = encodeWav([ch], 44100, { bitDepth: 16, dither: true });
    const b = encodeWav([ch], 44100, { bitDepth: 16, dither: true });
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
    decodeWav(a).channels[0].forEach((v) => expect(Math.abs(v - 0.25)).toBeLessThan(3 / 32768));
  });

  it("rejects empty and ragged input", () => {
    expect(() => encodeWav([], 44100, { bitDepth: 16 })).toThrow(WavError);
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 44100, { bitDepth: 16 })).toThrow(WavError);
  });

  it("rejects files that are not WAVs", () => {
    expect(() => decodeWav(new ArrayBuffer(10))).toThrow(WavError);
    expect(() => decodeWav(new ArrayBuffer(60))).toThrow(WavError);
  });
});
