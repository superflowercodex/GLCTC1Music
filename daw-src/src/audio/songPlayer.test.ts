import { describe, expect, it } from "vitest";
import { Clock, type Ticker } from "./clock";
import { SongPlayer, type PatternTarget } from "./songPlayer";
import { templateSections } from "../rooms/song/songModel";
import type { Song, SongPattern } from "../project/model";

class ManualTicker implements Ticker {
  private cb: (() => void) | null = null;
  start(onTick: () => void) {
    this.cb = onTick;
  }
  stop() {
    this.cb = null;
  }
  fire() {
    this.cb?.();
  }
}

class FakeInstrument implements PatternTarget {
  activePattern: number | null;
  /** [step the clock was on when the pattern was set, new pattern] */
  history: Array<[number, number | null]> = [];
  constructor(initial: number | null, private readonly now: () => number) {
    this.activePattern = initial;
  }
  setPattern(index: number | null): void {
    this.activePattern = index;
    this.history.push([this.now(), index]);
  }
}

function setup(row: Record<string, SongPattern[]>, templateId: "16" | "32" = "16") {
  const ctx = { currentTime: 0 };
  const ticker = new ManualTicker();
  const clock = new Clock(ctx as unknown as BaseAudioContext, ticker);
  clock.bpm = 120;
  let currentStep = -1;
  // Registered first, like the engine's instrument subscriptions, so it sees each step before the player does.
  const played: Array<{ step: number; slot: string; pattern: number | null }> = [];
  const instruments = Object.fromEntries(Object.keys(row).map((id) => [id, new FakeInstrument(2, () => currentStep)]));
  clock.subscribe((step) => {
    currentStep = step;
    for (const [slot, inst] of Object.entries(instruments)) played.push({ step, slot, pattern: inst.activePattern });
  });
  const levels: Record<string, number | null> = {};
  const player = new SongPlayer({
    clock,
    instrument: (id) => instruments[id],
    beatsPerBar: () => 4,
    setLevelDb: (id, db) => {
      levels[id] = db;
    },
  });
  const song: Song = { sections: templateSections(templateId), matrix: row };
  const run = (seconds: number) => {
    for (let t = 0; t <= seconds; t += 0.025) {
      ctx.currentTime = t;
      ticker.fire();
    }
  };
  return { clock, player, song, instruments, played, levels, run };
}

describe("SongPlayer", () => {
  // 120 BPM: a bar is 16 steps and lasts 2 s, so a 4-bar section is 64 steps. 16-bar template: Intro 1-4, Build 5-8, Drop 9-12, Outro 13-16.
  it("switches every instrument's pattern exactly on the bar line a section starts", () => {
    const { player, song, played, run } = setup({ a: [1, 2, 3, 0] });
    player.play(song);
    run(30);
    const patternAt = (step: number) => played.find((p) => p.step === step)?.pattern;
    expect(patternAt(0)).toBe(0);
    expect(patternAt(63)).toBe(0);
    expect(patternAt(64)).toBe(1);
    expect(patternAt(127)).toBe(1);
    expect(patternAt(128)).toBe(2);
    expect(patternAt(192)).toBeNull();
  });

  it("silences an off cell and restores the original pattern when the song ends", async () => {
    const { player, song, instruments, clock, run } = setup({ a: [1, 0, 1, 0] });
    player.play(song);
    run(40);
    await Promise.resolve();
    expect(player.getState().mode).toBe("idle");
    expect(clock.playing).toBe(false);
    expect(instruments.a.activePattern).toBe(2);
  });

  it("stops on request, restoring patterns, loop and mixer levels", () => {
    const { player, song, instruments, clock, levels, run } = setup({ a: [1, 1, 1, 1] });
    const loop = { startStep: 8, endStep: 24 };
    clock.loop = loop;
    song.levels = { a: 1 };
    player.play(song);
    expect(levels.a).toBe(0);
    expect(clock.loop).toBeNull();
    run(3);
    player.stop();
    expect(clock.playing).toBe(false);
    expect(clock.loop).toBe(loop);
    expect(instruments.a.activePattern).toBe(2);
    expect(levels.a).toBeNull();
  });

  it("loops a single section and keeps its pattern across the wrap", () => {
    const { player, song, played, clock, run } = setup({ a: [1, 2, 3, 0] });
    player.play(song, 1);
    expect(player.getState()).toEqual({ mode: "section", section: 1 });
    expect(clock.loop).toEqual({ startStep: 64, endStep: 128 });
    run(20);
    const steps = played.map((p) => p.step);
    expect(Math.min(...steps)).toBe(64);
    expect(Math.max(...steps)).toBeLessThan(128);
    expect(played.every((p) => p.pattern === 1)).toBe(true);
    expect(steps.filter((s) => s === 64).length).toBeGreaterThan(1);
  });

  it("lets go of patterns and loop when something else stops the clock, and can preview again", () => {
    const { player, song, instruments, clock, run } = setup({ a: [1, 1, 1, 1] });
    const loop = { startStep: 8, endStep: 24 };
    clock.loop = loop;
    player.play(song, 1);
    run(2);
    clock.stop();
    expect(player.getState().mode).toBe("idle");
    expect(clock.loop).toBe(loop);
    expect(instruments.a.activePattern).toBe(2);
    player.play(song);
    expect(player.getState().mode).toBe("song");
    expect(clock.playing).toBe(true);
    player.stop();
    expect(instruments.a.activePattern).toBe(2);
    expect(clock.loop).toBe(loop);
  });

  it("stops the preview when Arrange-style playback takes the clock", () => {
    const { player, song, instruments, clock, levels, run } = setup({ a: [1, 1, 1, 1] });
    player.play(song);
    run(1);
    clock.stop();
    clock.start(0);
    expect(player.getState().mode).toBe("idle");
    expect(levels.a).toBeNull();
    expect(instruments.a.activePattern).toBe(2);
    expect(clock.playing).toBe(true);
  });

  it("does nothing for an empty song", () => {
    const { player, run, clock } = setup({ a: [] });
    player.play({ sections: [], matrix: {} });
    run(1);
    expect(clock.playing).toBe(false);
    expect(player.getState().mode).toBe("idle");
  });
});
