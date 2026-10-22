import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import { detectTempoAndKey, fft } from "./analysis";

const SR = 44100;

function makeBuffer(seconds: number, fill: (data: Float32Array) => void): AudioBuffer {
  const ctx = new OfflineAudioContext(1, Math.floor(seconds * SR), SR);
  const buffer = ctx.createBuffer(1, Math.floor(seconds * SR), SR);
  fill(buffer.getChannelData(0));
  return buffer as unknown as AudioBuffer;
}

/** A short decaying noise burst on every beat, with a quiet off-beat hat to make the grid less trivial. */
function clickTrack(bpm: number, seconds: number): AudioBuffer {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  return makeBuffer(seconds, (d) => {
    const beat = (60 / bpm) * SR;
    for (let b = 0; b * beat < d.length; b++) {
      const at = Math.round(b * beat);
      for (let i = 0; i < 1500 && at + i < d.length; i++) d[at + i] += rand() * Math.exp(-i / 300);
      const off = Math.round(at + beat / 2);
      for (let i = 0; i < 600 && off + i < d.length; i++) d[off + i] += 0.25 * rand() * Math.exp(-i / 120);
    }
  });
}

async function arpeggio(notes: number[], seconds: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.floor(seconds * SR), SR);
  const step = 0.25;
  for (let i = 0; i * step < seconds; i++) {
    const midi = notes[i % notes.length];
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.value = 0.4;
    osc.connect(g).connect(ctx.destination);
    osc.start(i * step);
    osc.stop(i * step + step);
  }
  return (await ctx.startRendering()) as unknown as AudioBuffer;
}

describe("tempo detection", () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ${bpm} BPM from a click track`, async () => {
      const found = await detectTempoAndKey(clickTrack(bpm, 24));
      expect(found.bpm).toBeDefined();
      expect(Math.abs(found.bpm! - bpm)).toBeLessThan(1.5);
    });
  }

  it("is not sure about a steady tone with no rhythm", async () => {
    const tone = makeBuffer(12, (d) => {
      for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
    });
    expect((await detectTempoAndKey(tone)).bpm).toBeUndefined();
  });

  it("is not sure about silence", async () => {
    expect(await detectTempoAndKey(makeBuffer(8, () => {}))).toEqual({});
  });
});

describe("key detection", () => {
  // MIDI notes: the tonic triad plus the scale degrees that separate the key from its relative.
  const cases: Array<[string, number[]]> = [
    ["A minor", [57, 60, 64, 57, 62, 65, 57, 59, 64, 69, 64, 60, 57, 64, 69, 72]],
    ["C major", [60, 64, 67, 60, 62, 65, 60, 64, 71, 72, 67, 64, 60, 67, 72, 76]],
    ["D major", [62, 66, 69, 62, 64, 67, 62, 66, 73, 74, 69, 66, 62, 69, 74, 78]],
    ["E♭ major", [63, 67, 70, 63, 65, 68, 63, 67, 74, 75, 70, 67, 63, 70, 75, 79]],
  ];
  for (const [name, notes] of cases) {
    it(`names ${name} from an arpeggio`, async () => {
      const found = await detectTempoAndKey(await arpeggio(notes, 20));
      expect(found.key).toBe(name);
    });
  }
});

describe("fft", () => {
  it("puts a sine in the right bin", () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 40 * i) / n);
    fft(re, im);
    let best = 1;
    for (let k = 1; k < n / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
    expect(best).toBe(40);
  });
});
