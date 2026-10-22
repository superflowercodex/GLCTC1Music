import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formantsFor, VOICE_TYPES } from "./choir";
import { Choir } from "./choirEngine";
import { onsetKind, parseLyrics } from "./lyrics";
import { renderPianoNote } from "./piano";
import { describeRange, zoneFor, zoneRanges } from "./sampler";
import { autoSlice, evenSlices, normaliseSlices, sliceRange } from "./slice";
import { SYNTH_KINDS, renderSynth } from "./synthKit";
import { BAND_COUNTS, Vocoder, bandCentres } from "./vocoder";
import { encodeWav } from "./wav";

type Offline = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
const Ctx = NodeOfflineContext as unknown as Offline;

function rmsOf(buffer: AudioBuffer, from = 0, to = buffer.length): number {
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, amp = 0.5): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * amp;
  return buffer;
}

describe("vocoder", () => {
  async function render(modulator: "noise" | "silent", carrier: "noise" | "silent", bands: number): Promise<number> {
    const ctx = new Ctx(1, 22050, 44100);
    const vocoder = new Vocoder(ctx);
    vocoder.configure({ bands, level: 5, sibilance: 0 });
    vocoder.output.connect(ctx.destination);
    for (const [kind, input] of [[modulator, vocoder.modulator], [carrier, vocoder.carrier]] as const) {
      const src = ctx.createBufferSource();
      src.buffer = kind === "noise" ? noiseBuffer(ctx, 0.5) : ctx.createBuffer(1, 22050, 44100);
      src.connect(input);
      src.start();
    }
    return rmsOf(await ctx.startRendering(), 4410);
  }

  it.each(BAND_COUNTS)("makes sound from a noisy carrier at %d bands", async (bands) => {
    expect(await render("noise", "noise", bands)).toBeGreaterThan(0.001);
  });

  it("is silent when the voice is silent", async () => {
    expect(await render("silent", "noise", 16)).toBeLessThan(1e-4);
  });

  it("is silent when there is no carrier", async () => {
    expect(await render("noise", "silent", 16)).toBeLessThan(0.01);
  });

  it("rebuilds with the requested band count", () => {
    const vocoder = new Vocoder(new Ctx(1, 128, 44100) as unknown as BaseAudioContext);
    vocoder.configure({ bands: 8 });
    expect(vocoder.bandCount).toBe(8);
    vocoder.configure({ bands: 24 });
    expect(vocoder.bandCount).toBe(24);
  });

  it("spaces band centres evenly on a log axis inside the voice range", () => {
    const centres = bandCentres(16);
    expect(centres[0]).toBeGreaterThan(90);
    expect(centres[15]).toBeLessThan(8500);
    const ratios = centres.slice(1).map((c, i) => c / centres[i]);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-9);
  });
});

describe("choir", () => {
  it("parses lyrics into sung syllables", () => {
    const syllables = parseLyrics("Hello, frequency");
    expect(syllables.map((s) => s.text)).toEqual(["hel", "lo", "fre", "quen", "cy"]);
    expect(parseLyrics("la lo ah ooh").map((s) => s.vowel)).toEqual(["Ah", "Oh", "Ah", "Oo"]);
    expect(parseLyrics("")).toEqual([]);
    expect(parseLyrics("123 !!!")).toEqual([]);
  });

  it("classifies consonant onsets", () => {
    expect(onsetKind("s")).toBe("noise");
    expect(onsetKind("l")).toBe("glide");
    expect(onsetKind("")).toBe("none");
  });

  it("gives five formants per voice and morph position, rising in frequency", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VOICE_TYPES), fc.double({ min: 0, max: 1, noNaN: true }), (type, morph) => {
        const f = formantsFor(type, morph);
        return f.length === 5 && f.every((x, i) => i === 0 || x.freq > f[i - 1].freq) && f.every((x) => x.gain > 0);
      }),
    );
  });

  it("sings played notes and falls silent after release", async () => {
    const ctx = new Ctx(2, 44100 * 3, 44100);
    const choir = new Choir(ctx);
    choir.output.connect(ctx.destination);
    choir.settings = { ...choir.settings, attack: 0.02, release: 0.1 };
    choir.noteOn(60, 0.9, 0);
    choir.noteOff(60, 1);
    const out = await ctx.startRendering();
    expect(rmsOf(out, 22050, 44100)).toBeGreaterThan(0.005);
    expect(rmsOf(out, 44100 * 2, 44100 * 3)).toBeLessThan(0.0005);
  });
});

describe("key zones", () => {
  it("covers every key exactly once, with no gaps or overlaps", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 127 }), { minLength: 1, maxLength: 8 }), (roots) => {
        const distinct = [...new Set(roots)];
        const ranges = zoneRanges(distinct);
        for (let key = 0; key <= 127; key++) {
          const hits = ranges.filter((r) => key >= r.lo && key <= r.hi).length;
          if (hits !== 1) return false;
        }
        return distinct.every((root, i) => root >= ranges[i].lo && root <= ranges[i].hi);
      }),
    );
  });

  it("picks the nearest sample and describes ranges", () => {
    expect(zoneFor([48, 72], 50)).toBe(0);
    expect(zoneFor([48, 72], 70)).toBe(1);
    expect(zoneFor([], 60)).toBe(-1);
    expect(describeRange({ lo: 36, hi: 59 })).toBe("C2 – B3");
    expect(describeRange({ lo: 96, hi: 127 })).toBe("C7 and up");
  });
});

describe("slices", () => {
  it("normalises any list into sorted, spaced points inside the sample", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -0.5, max: 1.5, noNaN: true }), { maxLength: 30 }), (points) => {
        const out = normaliseSlices(points);
        return out.every((p, i) => p > 0 && p < 1 && (i === 0 || p - out[i - 1] >= 0.005));
      }),
    );
  });

  it("gives contiguous ranges from zero to one whatever the cut points", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0.01, max: 0.99, noNaN: true }), { maxLength: 10 }), (raw) => {
        const cuts = normaliseSlices(raw);
        let at = 0;
        for (let i = 0; i <= cuts.length; i++) {
          const [a, b] = sliceRange(cuts, i);
          if (Math.abs(a - at) > 1e-12 || b <= a) return false;
          at = b;
        }
        return at === 1;
      }),
    );
  });

  it("makes even slices", () => {
    expect(evenSlices(4)).toEqual([0.25, 0.5, 0.75]);
    expect(evenSlices(1)).toEqual([]);
  });

  it("finds the hits in a click track and always returns valid points", () => {
    const data = new Float32Array(44100);
    for (const at of [0.25, 0.5, 0.75]) for (let i = 0; i < 400; i++) data[Math.floor(at * data.length) + i] = Math.sin(i) * 0.9;
    const found = autoSlice(data);
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const at of [0.25, 0.5, 0.75]) expect(found.some((f) => Math.abs(f - at) < 0.02)).toBe(true);
    expect(autoSlice(new Float32Array(1000)).every((p) => p > 0 && p < 1)).toBe(true);
    fc.assert(fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 600, maxLength: 3000 }), (arr) => {
      const out = autoSlice(Float32Array.from(arr), 8);
      return out.length <= 7 && out.every((p, i) => p > 0 && p < 1 && (i === 0 || p > out[i - 1]));
    }), { numRuns: 30 });
  });
});

describe("generated sounds", () => {
  it.each(SYNTH_KINDS)("renders audible, finite %s", (kind) => {
    const data = renderSynth(kind, 44100);
    expect(data.length).toBeGreaterThan(1000);
    let peak = 0;
    for (const v of data) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(1.6);
  });

  it("renders a piano note that rings and decays", () => {
    const note = renderPianoNote(60, "Grand", 24000);
    const early = note.slice(0, 2400).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const late = note.slice(note.length - 2400).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(early).toBeGreaterThan(0.3);
    expect(late).toBeLessThan(early / 2);
  });

  it("encodes WAV with a correct header and size", async () => {
    const ctx = new Ctx(2, 100, 44100);
    const buffer = ctx.createBuffer(2, 100, 44100);
    const blob = encodeWav(buffer);
    expect(blob.size).toBe(44 + 100 * 2 * 2);
    const view = new DataView(await blob.arrayBuffer());
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(44100);
  });
});
