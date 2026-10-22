import { LENGTHS } from "../audio/instruments/divine09";
import { PAD_KINDS } from "../audio/instruments/drums/voicesPad";
import { emptyPattern, emptyStep, type GPattern } from "../audio/instruments/synth/patternGen";
import type { InstrumentKind, InstrumentState } from "../audio/types";
import { matrixRowToClips } from "../rooms/song/songModel";
import { newProject, type AutomationLane, type Insert, type InstrumentSlot, type Project, type SectionKind, type SongPattern, type Track } from "./model";

/*
 * MIDNIGHT SIGNAL (built-in demo) - composition notes
 *
 * Style: melodic electronic / neon house, 120 BPM, A minor lifting to B minor, 61 bars, room left in the mids
 * (1 to 4 kHz) for a singer on the Vocal track.
 *
 * Hook (Galactic One, patch A, a warm low-passed saw lead with a slow vibrato): a 2-bar phrase that is sung as much as played.
 *   | E5 . D5 E5 . G5 . E5 | A5 . . G5 E5 . D5 . |
 *   Stepwise E-D-E, a syncopated G on the "and" of 3, then one leap of a fourth (E up to A) onto the high point,
 *   held over a rest, and a stepwise fall back. Rests on beats 3 and 4 give it a rhythm you can clap.
 * Variations: the same motif over C (reharmonised: E is now the third), an answer that resolves through a 4-3
 *   suspension (C5 to B4 over G), a version displaced by an eighth, an ending that climbs to A5 on the "and" of 4
 *   to push into the next bar, a sparse teaser for the intro and outro, and an octave doubling for the last drops.
 *
 * Harmony: Am7 - Fmaj7 - Cmaj7 - G(add9), one chord per bar. The pad plays shell voicings (third and seventh,
 *   fifth and ninth on G) and strikes the next chord early, on the "and" of 4. The bass anticipates the next root
 *   on the same "and", walks through passing notes (C/E, then G-B-A) and never lands on a kick. The final drops
 *   lift a whole tone to B minor (Bm7 - Gmaj7 - Dmaj7 - A(add9)) and the song resolves on B minor.
 *
 * Rhythm: swung 909 kit with ghost rims and off-beat open hats, a shaker and conga layer (80LA8) with its own
 *   ghost velocities, a syncopated rolling bass, and a dotted-eighth arpeggio (0010110) that runs three against
 *   the four of the groove.
 *
 * Eight designed moments:
 *   1. The pad opens out of a closed filter in the first bars, then the hook appears as a fragment (bar 5).
 *   2. Kick and bass arrive together at bar 9, with the arpeggio shimmering in behind.
 *   3. The rise: an acid pedal opens its filter, the snare rolls from quarters to 16ths, the riser climbs.
 *   4. Silence: drums and bass drop out for the last two beats before the drop.
 *   5. The drop lands with the full hook, call and answer every 4 bars, fills at the end of each 4.
 *   6. The break strips everything but a darkened pad: the hook comes back alone.
 *   7. The key lift: on the "and" of 4 before the final drop everything moves up a whole tone, the lead doubles
 *      an octave up and the drums and percussion get busier.
 *   8. The ending: the teaser returns over an open pad, and the song resolves on one held B minor chord.
 *
 * Every part is a pattern (4 per instrument at most), so the Song matrix and the Arrange clips play the same song.
 */

export const DEMO_BPM = 120;
export const DEMO_NAME = "Midnight Signal (demo)";
export const DEMO_KEY = "A minor";
export const DEMO_TRACKS = { drums: "Drums", perc: "Percussion", bass: "Bass", keys: "Lead + Pad", arp: "Arp", acid: "Rise synth", vocal: "Vocal" } as const;
export type DemoRole = "drums" | "perc" | "bass" | "keys" | "arp" | "acid";

export interface DemoChord {
  name: string;
  /** Pitch classes the harmony sounds (with its seventh or ninth), root first. */
  tones: readonly number[];
}

/** One chord per bar, repeating every 4 bars from bar 1, in A minor; the lift adds two semitones. */
const CHORDS_A: readonly DemoChord[] = [
  { name: "Am7", tones: [9, 0, 4, 7] },
  { name: "Fmaj7", tones: [5, 9, 0, 4] },
  { name: "Cmaj7", tones: [0, 4, 7, 11] },
  { name: "G(add9)", tones: [7, 11, 2, 9] },
];
const LIFT_NAMES = ["Bm7", "Gmaj7", "Dmaj7", "A(add9)"];
export const A_MINOR: ReadonlySet<number> = new Set([9, 11, 0, 2, 4, 5, 7]);
export const B_MINOR: ReadonlySet<number> = new Set([11, 1, 2, 4, 6, 7, 9]);

/** Bar 40, the "and" of beat 4: everything moves up a tone half a beat before the final drop. */
export const LIFT_BAR = 40;
export const LIFT_STEP = (LIFT_BAR - 1) * 16 + 14;
export const LIFT_SEMITONES = 2;

export function liftAt(step: number): number {
  return step >= LIFT_STEP ? LIFT_SEMITONES : 0;
}

export function chordAtBar(bar: number): DemoChord {
  const i = (bar - 1) % 4;
  const lift = liftAt((bar - 1) * 16);
  return lift ? { name: LIFT_NAMES[i], tones: CHORDS_A[i].tones.map((t) => (t + lift) % 12) } : CHORDS_A[i];
}

export function keyAtStep(step: number): ReadonlySet<number> {
  return liftAt(step) ? B_MINOR : A_MINOR;
}

export interface DemoSection {
  name: string;
  bars: number;
  kind: SectionKind;
  /** Song matrix value per instrument: 0 off, 1 to 4 for patterns A to D. */
  parts: Record<DemoRole, SongPattern>;
}

const sec = (name: string, bars: number, kind: SectionKind, drums: SongPattern, perc: SongPattern, bass: SongPattern, keys: SongPattern, arp: SongPattern, acid: SongPattern): DemoSection => ({
  name,
  bars,
  kind,
  parts: { drums, perc, bass, keys, arp, acid },
});

// Keys patterns: 1 pad alone, 2 hook (call), 3 hook (answer), 4 teaser. Every section but the last starts on a
// 4-bar line, so the 4-bar parts always begin on the first chord; the 8-bar drum patterns cover pairs of sections.
export const DEMO_SECTIONS: readonly DemoSection[] = [
  //  name            bars kind      drums perc bass keys arp acid
  sec("Intro", 4, "intro", 1, 1, 0, 1, 0, 0),
  sec("Intro theme", 4, "intro", 1, 1, 0, 4, 1, 0),
  sec("Build", 4, "build", 2, 2, 2, 1, 1, 0),
  sec("Rise", 4, "build", 2, 2, 2, 1, 0, 1),
  sec("Drop", 4, "drop", 3, 3, 3, 2, 0, 0),
  sec("Answer", 4, "drop", 3, 3, 3, 3, 0, 0),
  sec("Drop", 4, "drop", 3, 3, 3, 2, 1, 0),
  sec("Answer", 4, "drop", 3, 3, 3, 3, 1, 0),
  sec("Break", 4, "break", 0, 0, 0, 2, 0, 0),
  sec("Lift", 4, "build", 2, 2, 2, 1, 0, 1),
  sec("Final drop", 4, "drop", 4, 4, 4, 2, 1, 0),
  sec("Final answer", 4, "drop", 4, 4, 4, 3, 1, 0),
  sec("Final drop", 4, "drop", 4, 4, 4, 2, 1, 0),
  sec("Final answer", 4, "drop", 4, 4, 4, 3, 1, 0),
  sec("Outro", 4, "outro", 1, 1, 0, 4, 1, 0),
  // One bar: the B minor chord rings out into the tail.
  sec("End", 1, "outro", 0, 0, 1, 0, 0, 0),
];

export const STEPS_PER_BAR = 16;

export function demoSectionStarts(): number[] {
  const starts: number[] = [];
  let bar = 1;
  for (const s of DEMO_SECTIONS) {
    starts.push(bar);
    bar += s.bars;
  }
  return starts;
}

export function sectionAt(bar: number): DemoSection {
  const starts = demoSectionStarts();
  for (let i = starts.length - 1; i >= 0; i--) if (bar >= starts[i]) return DEMO_SECTIONS[i];
  return DEMO_SECTIONS[0];
}

/** Note names to MIDI numbers, so the parts below read like a lead sheet. */
const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new RangeError(`Demo song: "${name}" is not a note name.`);
  return (Number(m[3]) + 1) * 12 + NOTE_INDEX[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

const REST = "................";

// ----- Drums (Divine09, 128 steps = 8 bars per pattern) --------------------------------------------------

const KICK = 0;
const SNARE = 1;
const CLAP = 2;
const HAT = 3;
const OPEN_HAT = 4;
const RIM = 8;
const CRASH = 10;
const DIVINE_VOICES = 15;
const DIVINE_STEPS = 128;

type DrumRows = Partial<Record<number, readonly string[]>>;

/** Eight 16-character bars per voice: x is a hit, X an accent, anything else a rest. */
function drumPattern(rows: DrumRows): number[][] {
  return Array.from({ length: DIVINE_VOICES }, (_, voice) => {
    const bars = rows[voice];
    if (!bars) return new Array<number>(DIVINE_STEPS).fill(0);
    if (bars.length !== 8 || bars.some((b) => b.length !== 16)) throw new RangeError(`Demo song: drum voice ${voice} needs eight 16-step bars.`);
    return bars.flatMap((bar) => Array.from(bar, (c) => (c === "X" ? 2 : c === "x" ? 1 : 0)));
  });
}

const FOUR = "x...x...x...x...";
const BACKBEAT = "....X.......X...";
const OFF8 = "..x...x...x...x.";
const HATS16 = "xx.xxx.xxx.xxx.x";
const ACC16 = "xxXxxxXxxxXxxxXx";
const eight = (...b: string[]): string[] => (b.length === 8 ? b : [...b, ...new Array<string>(8 - b.length).fill(b[b.length - 1])]);

export const DRUM_PATTERNS: readonly number[][][] = [
  // A: intro and outro. Off-beat hats, a rim pulse in the second half, open-hat lifts at the ends of 4 bars.
  drumPattern({
    [HAT]: eight(OFF8, OFF8, OFF8, OFF8, OFF8, OFF8, OFF8, "..x...x...x.x.x."),
    [RIM]: [REST, REST, REST, REST, "....x.......x...", "....x.......x...", "....x.......x...", "....x.......x..x"],
    [OPEN_HAT]: [REST, REST, REST, "..............x.", REST, REST, REST, "..............x."],
  }),
  // B: build (bars 1-4) then rise (bars 5-8). The kick enters with the bass; the snare rolls from quarters to 16ths;
  // everything stops after beat 3 of bar 8, so the drop lands out of a moment of silence.
  drumPattern({
    [KICK]: eight(FOUR, FOUR, FOUR, FOUR, FOUR, FOUR, FOUR, "x...x...x......."),
    [HAT]: [OFF8, OFF8, ACC16, ACC16, ACC16, ACC16, ACC16, "xxXxxxXxx......."],
    [OPEN_HAT]: [OFF8, OFF8, OFF8, OFF8, REST, REST, REST, REST],
    [CLAP]: [BACKBEAT, BACKBEAT, BACKBEAT, BACKBEAT, REST, REST, REST, REST],
    [SNARE]: [REST, REST, REST, "..............xx", "x...x...x...x...", "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxxxx", "xxxxxxxxX......."],
    [CRASH]: ["X...............", REST, REST, REST, REST, REST, REST, REST],
  }),
  // C: drop. Four on the floor, clap and snare on 2 and 4, 16th hats around off-beat open hats, swung rim ghosts,
  // a short fill at the end of bar 4 and a longer one at the end of bar 8.
  drumPattern({
    [KICK]: eight(FOUR, FOUR, FOUR, FOUR, FOUR, FOUR, FOUR, "x...x...x......."),
    [CLAP]: eight(BACKBEAT),
    [SNARE]: [BACKBEAT, BACKBEAT, BACKBEAT, "....X.......Xxxx", BACKBEAT, BACKBEAT, BACKBEAT, "....X...x.x.XxXx"],
    [HAT]: [HATS16, HATS16, HATS16, "xx.xxx.xxx.x....", HATS16, HATS16, HATS16, "xx.xxx.x........"],
    [OPEN_HAT]: [OFF8, OFF8, OFF8, "..x...x...x.....", OFF8, OFF8, OFF8, "..x...x........."],
    [RIM]: ["...x......x...x.", ".......x..x.....", "...x......x...x.", "......x.........", "...x......x...x.", ".......x..x....x", "...x......x...x.", REST],
    [CRASH]: ["X...............", REST, REST, REST, "x...............", REST, REST, REST],
  }),
  // D: final drop. As C, with accented 16th hats, a busier ghost pattern and extra open hats.
  drumPattern({
    [KICK]: eight(FOUR, FOUR, FOUR, FOUR, FOUR, FOUR, FOUR, "x...x...x......."),
    [CLAP]: eight(BACKBEAT),
    [SNARE]: [BACKBEAT, BACKBEAT, BACKBEAT, "....X.....x.Xxxx", BACKBEAT, BACKBEAT, BACKBEAT, "....X...xxxxXXXX"],
    [HAT]: [ACC16, ACC16, ACC16, "xxXxxxXxxx......", ACC16, ACC16, ACC16, "xxXxxxXx........"],
    [OPEN_HAT]: [OFF8, "..x...x...x...xx", OFF8, "..x...x.........", OFF8, "..x...x...x...xx", OFF8, REST],
    [RIM]: ["...x..x...x...x.", ".......x..x..x..", "...x..x...x...x.", "......x.........", "...x..x...x...x.", ".......x..x..x..", "...x..x...x...x.", REST],
    [CRASH]: ["X...............", REST, REST, REST, "x...............", REST, REST, REST],
  }),
];

// ----- Percussion (80LA8, one 16-step bar per pattern, velocities 0 to 1) ------------------------------------

const P_SHAKER = 3;
const P_RIM = 7;
const P_CONGA = 9;
const PERC_VOICES = 12;

/** Digits are velocities in tenths ("5" is 0.5), dots are rests. */
function percPattern(rows: Partial<Record<number, string>>): number[][] {
  return Array.from({ length: PERC_VOICES }, (_, v) => Array.from(rows[v] ?? REST, (c) => (c >= "1" && c <= "9" ? Number(c) / 10 : 0)));
}

const SHAKER_SOFT = "3151315131513151";
const SHAKER_DRIVE = "3262326232623262";

export const PERC_PATTERNS: readonly number[][][] = [
  percPattern({ [P_SHAKER]: SHAKER_SOFT }),
  percPattern({ [P_SHAKER]: SHAKER_SOFT, [P_CONGA]: "...4......4....." }),
  percPattern({ [P_SHAKER]: SHAKER_DRIVE, [P_CONGA]: "...5..3...5...3.", [P_RIM]: ".......2.......2" }),
  percPattern({ [P_SHAKER]: SHAKER_DRIVE, [P_CONGA]: "...5..3...5..43.", [P_RIM]: "...2...3.......3" }),
];

// ----- Bass, riser and the last chord (PAD-64 as a tuned sampler, 64 steps = 4 bars per pattern) --------------

const PAD_LANES = 16;
const PAD_STEPS = 64;
const WARM_BASS = PAD_KINDS.indexOf("Warm bass");
const PAD_CHORD = PAD_KINDS.indexOf("Pad");
const PAD_RISER = PAD_KINDS.indexOf("Riser");
const PAD_IMPACT = PAD_KINDS.indexOf("Impact");
/** The warm bass sounds D2 at zero tune. */
const WARM_BASS_ROOT = midi("D2");

/** One lane per bass pitch the song uses, in both keys. */
export const BASS_NOTES = ["A1", "F1", "C2", "G1", "A2", "F2", "C3", "G2", "E2", "B1", "D2", "B2", "D3"] as const;
type BassNote = (typeof BASS_NOTES)[number];
const bassLane = (note: BassNote): number => BASS_NOTES.indexOf(note);
const RISER_LANE = 13;
const END_CHORD_LANE = 14;
const IMPACT_LANE = 15;
/** PAD-64's pad is a minor chord on C3; one semitone down it is B minor (B2 F#3 B3 D4). */
const END_CHORD_TUNE = -1;
/** PAD-64's riser sweeps for 1.7 s times its decay setting, which is at its maximum of 2 here. */
const RISER_SECONDS = 3.4;

type Roots = readonly (readonly [low: BassNote, high: BassNote])[];
const ROOTS_A: Roots = [["A1", "A2"], ["F1", "F2"], ["C2", "C3"], ["G1", "G2"]];
const ROOTS_B: Roots = [["B1", "B2"], ["G1", "G2"], ["D2", "D3"], ["A1", "A2"]];

/**
 * One bar of bass: L the chord's low root, H its octave, N the next chord's low root (pushed in on the "and" of 4),
 * p a passing note given separately. Steps 0, 4, 8 and 12 stay free for the kick.
 */
interface BassBar {
  shape: string;
  passing?: BassNote;
}

function bassPattern(bars: readonly BassBar[], roots: Roots, riser = false): number[][] {
  const rows = Array.from({ length: PAD_LANES }, () => new Array<number>(PAD_STEPS).fill(0));
  bars.forEach((bar, b) => {
    const [low, high] = roots[b];
    const next = roots[(b + 1) % 4][0];
    Array.from(bar.shape).forEach((c, s) => {
      const note: BassNote | undefined = c === "L" ? low : c === "H" ? high : c === "N" ? next : c === "p" ? bar.passing : undefined;
      if (note) rows[bassLane(note)][b * 16 + s] = 1;
    });
  });
  if (riser) rows[RISER_LANE][PAD_STEPS - Math.round(RISER_SECONDS / (60 / DEMO_BPM / 4))] = 1;
  return rows;
}

const ROLL = "..LH..LH..L..HN.";
const OFFBEATS = "..L...L...L...L.";

export const BASS_PATTERNS: readonly number[][][] = [
  // A: the ending: B minor on PAD-64's pad, a long low B and an impact, struck once.
  (() => {
    const rows = Array.from({ length: PAD_LANES }, () => new Array<number>(PAD_STEPS).fill(0));
    rows[END_CHORD_LANE][0] = 2;
    rows[bassLane("B1")][0] = 2;
    rows[IMPACT_LANE][0] = 1;
    return rows;
  })(),
  // B: build, rise and lift. Off-beat roots only, a riser over the last bars, and out after beat 3 of bar 4.
  bassPattern([{ shape: OFFBEATS }, { shape: OFFBEATS }, { shape: OFFBEATS }, { shape: "..L...L........." }], ROOTS_A, true),
  // C: drop. A rolling, syncopated octave bass between the kicks that pushes each chord in early and walks
  // through C/E and G-B-A.
  bassPattern([{ shape: ROLL }, { shape: ROLL }, { shape: "..LH..LH..p..HN.", passing: "E2" }, { shape: "..LH..LH..p...N.", passing: "B1" }], ROOTS_A),
  // D: the final drop, in B minor, with extra 16ths and a passing E under G.
  bassPattern([{ shape: ROLL }, { shape: "..LH.HLH..p..HN.", passing: "E2" }, { shape: ROLL }, { shape: "..LH..LH.HL..HN." }], ROOTS_B),
];

// ----- Keys: lead and pad (Galactic One at 1/8, 32 steps = 4 bars per bank) -----------------------------------

const GO_ROOT_MIDI = 57; // seq.root A, seq.octave 3
const EIGHTHS_PER_BAR = 8;
const PAD_BANK = 4;

/** One bar of eighth notes; null is a rest. */
type Line = readonly (string | null)[];

const HOOK_A: Line = ["E5", null, "D5", "E5", null, "G5", null, "E5"];
const HOOK_B: Line = ["A5", null, null, "G5", "E5", null, "D5", null];
const RESOLVE: Line = ["D5", null, null, "C5", "B4", null, null, null];

export const LEAD_LINES: Readonly<Record<"call" | "answer" | "teaser", readonly Line[]>> = {
  // Call: the 2-bar hook, then its first bar again over C, then the 4-3 suspension over G.
  call: [HOOK_A, HOOK_B, HOOK_A, RESOLVE],
  // Answer: the hook displaced by an eighth over C, then a climb that pushes A5 in on the "and" of 4.
  answer: [HOOK_A, HOOK_B, [null, "E5", null, "D5", "E5", null, "G5", "E5"], ["D5", null, "E5", null, "G5", null, null, "A5"]],
  // Teaser: fragments of the hook with room around them.
  teaser: [["E5", null, "D5", "E5", null, null, null, null], ["A5", null, null, null, null, null, null, null], ["E5", null, "D5", "E5", null, null, "G5", null], RESOLVE],
};

/**
 * The pad plays the third and seventh of each chord (the fifth and ninth on G), Galactic One's second
 * oscillator adding the upper note a fifth above the written one, and strikes the next chord on the "and" of 4.
 */
export const PAD_NOTES: readonly string[] = ["C4", "A3", "E4", "D4"];
export const PAD_UPPER_INTERVAL = 7;
const PAD_SLOTS: readonly number[] = [0, 2, 4, 6];
const PAD_PUSH_SLOT = 7;

const HUMAN_VELOCITY: readonly number[] = [0.02, -0.03, 0.04, -0.01, 0.03, -0.04, 0.01, -0.02, 0, 0.03, -0.02, 0.02, -0.03];

function leadBank(lines: readonly Line[]): GPattern {
  const pattern = emptyPattern();
  pattern.len = 32;
  lines.forEach((line, bar) =>
    line.forEach((name, slot) => {
      if (!name) return;
      const strong = slot === 0 || slot === 4;
      // Small, fixed differences in velocity (which also moves the filter) so the line breathes like a played part,
      // and notes before a rest held to the full eighth, the way a singer would phrase them.
      const lilt = HUMAN_VELOCITY[(bar * EIGHTHS_PER_BAR + slot) % HUMAN_VELOCITY.length];
      const beforeRest = line[slot + 1] === null || slot === line.length - 1;
      pattern.steps[bar * EIGHTHS_PER_BAR + slot] = { ...emptyStep(), on: true, n: midi(name) - GO_ROOT_MIDI, v: (strong ? 0.88 : 0.76) + lilt, g: beforeRest ? 1 : 0.85 };
    }),
  );
  return pattern;
}

function padBank(): GPattern {
  const pattern = emptyPattern();
  pattern.len = 32;
  PAD_NOTES.forEach((name, bar) => {
    for (const slot of PAD_SLOTS) pattern.steps[bar * EIGHTHS_PER_BAR + slot] = { ...emptyStep(), on: true, n: midi(name) - GO_ROOT_MIDI, v: slot === 0 ? 0.85 : 0.7, g: 1 };
    pattern.steps[bar * EIGHTHS_PER_BAR + PAD_PUSH_SLOT] = { ...emptyStep(), on: true, n: midi(PAD_NOTES[(bar + 1) % 4]) - GO_ROOT_MIDI, v: 0.8, g: 1 };
  });
  return pattern;
}

function keysBanks(): GPattern[] {
  const empty = emptyPattern();
  empty.len = 32;
  const banks = [empty, leadBank(LEAD_LINES.call), leadBank(LEAD_LINES.answer), leadBank(LEAD_LINES.teaser), padBank()];
  while (banks.length < 8) banks.push(emptyPattern());
  return banks;
}

// ----- Arp (0010110: one 16-step bar of minor pentatonic degrees) ---------------------------------------------

/** Degrees 1-8 of A minor pentatonic from A3: A3 C4 D4 E4 G4 A4 C5 D5. */
const ARP_ROOT_MIDI = 57;
const ARP_SCALE = [0, 3, 5, 7, 10];
/**
 * A note every three 16ths: a dotted-eighth figure that turns against the four-on-the-floor and only lines up
 * again every three beats. It uses A, D, E and G, which sit well over every chord of the loop.
 */
export const ARP_DEGREES: readonly number[] = [6, 0, 0, 4, 0, 0, 5, 0, 0, 6, 0, 0, 4, 0, 0, 3];

function arpMidi(degree: number): number {
  const d = degree - 1;
  return ARP_ROOT_MIDI + Math.floor(d / 5) * 12 + ARP_SCALE[d % 5];
}

// ----- Rise synth (30LEE: a 16th pedal on A whose filter opens through the rises) ------------------------------

const ACID_STEPS = Array.from({ length: 16 }, (_, i) => ({
  on: true,
  note: midi("A2"),
  oct: (i === 6 || i === 14 ? 1 : 0) as -1 | 0 | 1,
  accent: [0, 3, 6, 10, 13].includes(i),
  slide: i === 7 || i === 15,
}));

// ----- Instrument state ------------------------------------------------------------------------------

const DEMO_SEED = 20261022;

function drumState(): InstrumentState {
  return {
    kind: "divine09",
    presetId: "kit-909",
    values: {
      kit: 0,
      length: LENGTHS.indexOf(DIVINE_STEPS as (typeof LENGTHS)[number]),
      swing: 0.1,
      // Below about 0.4 the kit's glue compressor and safety clipper stay linear, so hits keep their attack.
      level: 0.34,
      drive: 0,
      room: 0.16,
      hat: 0.45,
      filter: 1,
      // The "Loose" kick profile adds a second, detuned body oscillator: weight under the click, on A1 (55 Hz).
      "v0.profile": 5,
      "v0.decay": 0.9,
      "v0.level": 0.75,
      "v1.level": 0.55,
      "v1.decay": 1.3,
      "v1.tone": -0.35,
      "v1.reverb": 0.14,
      "v2.level": 0.38,
      "v2.decay": 1.8,
      "v2.tone": -0.35,
      "v2.reverb": 0.25,
      "v3.level": 0.9,
      "v3.tone": -0.3,
      "v4.level": 0.65,
      "v4.tone": -0.35,
      "v8.level": 0.3,
      "v8.tone": -0.3,
      "v10.level": 0.26,
      "v10.tone": -0.45,
    },
    data: { patterns: DRUM_PATTERNS, pattern: 0, voice: 0, samples: [] },
  };
}

function percState(): InstrumentState {
  const values: Record<string, number> = { swing: 0.1 };
  for (let v = 0; v < PERC_VOICES; v++) values[`v${v}.level`] = 0;
  Object.assign(values, {
    [`v${P_SHAKER}.level`]: 0.55, [`v${P_SHAKER}.tone`]: 9500, [`v${P_SHAKER}.pan`]: 0.35, [`v${P_SHAKER}.reverb`]: 0.15,
    [`v${P_CONGA}.level`]: 0.6, [`v${P_CONGA}.tone`]: 5000, [`v${P_CONGA}.pan`]: -0.3, [`v${P_CONGA}.decay`]: 0.25, [`v${P_CONGA}.reverb`]: 0.25,
    [`v${P_RIM}.level`]: 0.4, [`v${P_RIM}.tone`]: 6000, [`v${P_RIM}.pan`]: 0.2, [`v${P_RIM}.reverb`]: 0.3,
  });
  return { kind: "drum80la8", presetId: "solar", values, data: { patterns: PERC_PATTERNS, pattern: 0, voice: 0, samples: [] } };
}

function bassState(): InstrumentState {
  const values: Record<string, number> = { swing: 0, bars: 3 };
  for (let lane = 0; lane < PAD_LANES; lane++) values[`v${lane}.level`] = 0;
  BASS_NOTES.forEach((note, lane) => {
    const high = midi(note) >= midi("E2");
    Object.assign(values, {
      [`v${lane}.kind`]: WARM_BASS,
      [`v${lane}.tune`]: midi(note) - WARM_BASS_ROOT,
      // The upper octave is shorter and lighter, so the line rolls instead of booming.
      [`v${lane}.level`]: high ? 0.62 : 0.72,
      [`v${lane}.decay`]: high ? 0.55 : 0.85,
      [`v${lane}.tone`]: 0,
      [`v${lane}.pan`]: 0,
    });
  });
  Object.assign(values, {
    [`v${RISER_LANE}.kind`]: PAD_RISER, [`v${RISER_LANE}.level`]: 0.3, [`v${RISER_LANE}.decay`]: 2, [`v${RISER_LANE}.tone`]: -0.45, [`v${RISER_LANE}.pan`]: 0,
    [`v${END_CHORD_LANE}.kind`]: PAD_CHORD, [`v${END_CHORD_LANE}.tune`]: END_CHORD_TUNE, [`v${END_CHORD_LANE}.level`]: 0.5, [`v${END_CHORD_LANE}.decay`]: 2, [`v${END_CHORD_LANE}.tone`]: -0.2, [`v${END_CHORD_LANE}.pan`]: 0,
    [`v${IMPACT_LANE}.kind`]: PAD_IMPACT, [`v${IMPACT_LANE}.level`]: 0.3, [`v${IMPACT_LANE}.decay`]: 1.4, [`v${IMPACT_LANE}.tone`]: -0.4, [`v${IMPACT_LANE}.pan`]: 0,
  });
  return { kind: "pad64", presetId: "classic", values, data: { patterns: BASS_PATTERNS, pattern: 0, laneMap: new Array<number>(PAD_LANES).fill(0), scene: -1, chain: false, voice: 0, samples: [] } };
}

/**
 * The lead: two saws through a gently closing 24 dB low-pass, three unison voices only 4 cents apart, a sine sub
 * and a slow, shallow vibrato that fades in on held notes. Chosen from an offline audition of twelve candidates
 * (see LEAD_ALTERNATIVES): the earlier wide stack (four voices 16 cents apart plus a 7-cent second saw) beat
 * audibly on held notes (4.5 dB of level flutter against 1.9 dB now) and put 12% of its energy at 2-6 kHz, where
 * a singer needs room (4% now), while its fundamentals stay clear.
 */
const LEAD_PATCH: Record<string, number> = {
  o1wave: 0, o1oct: 2, o1fine: 0, o1lvl: 0.8, o2wave: 0, o2oct: 2, o2semi: 0, o2fine: 2, o2lvl: 0.55,
  sub: 0.08, subwave: 1, noise: 0, ring: 0, xmod: 0, uni: 3, spread: 4, width: 0.7, drift: 0,
  hpf: 200, cut: 1200, res: 0.04, drive: 0, slope: 1, fenv: 0.3, key: 0.4, fvel: 0.35,
  fa: 0.004, fd: 0.35, fs: 0.25, fr: 0.22, aa: 0.008, ad: 0.4, as: 0.55, ar: 0.22, avel: 0.4, vol: 0.45,
  l1pitch: 0.035, l1rate: 5, l1delay: 0.3, l1cut: 0, l1pw: 0, l1amp: 0, mwvib: 0, mwcut: 0, mode: 0, glide: 0, penv: 0,
};

/** Three other leads from the audition, rendered to docs/demo-stems/lead-alternatives so they can be chosen by ear. */
export const LEAD_ALTERNATIVES: Readonly<Record<string, Record<string, number>>> = {
  // Five unison voices close together through a darker filter: wider and smoother, a little less defined.
  "soft-supersaw": { uni: 5, spread: 9, o2fine: 3, o2lvl: 0.5, cut: 1150, res: 0.04, fenv: 0.22, fd: 0.5, aa: 0.012, as: 0.65, ar: 0.3, sub: 0.15, drift: 0, l1pitch: 0.03 },
  // The chosen sound an octave lower: warmest, but it shares the pad's register, so the pad would need to give way.
  "octave-lower": { o1oct: 1, o2oct: 1, uni: 3, spread: 4, o2fine: 2, o2lvl: 0.55, cut: 1500, res: 0.04, fenv: 0.3, drift: 0, sub: 0, l1pitch: 0.035, l1delay: 0.3, hpf: 120 },
  // Sine and triangle with a breath of pink noise and a slower attack: a soft, flute-like whistle.
  "breathy-flute": { o1wave: 4, o2wave: 3, o2fine: 3, o2lvl: 0.45, noise: 0.05, ncolor: 1, uni: 1, cut: 2600, res: 0, fenv: 0.1, aa: 0.03, ad: 0.3, as: 0.85, ar: 0.3, sub: 0.05, l1pitch: 0.07, l1delay: 0.3, l1rate: 5.2, drift: 0 },
};

/** The lead patch with an alternative applied, for auditioning; the song itself uses LEAD_PATCH. */
export function leadValues(alternative?: string): Record<string, number> {
  const patch = { ...LEAD_PATCH, ...(alternative ? LEAD_ALTERNATIVES[alternative] : {}) };
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => [`a.${k}`, v]));
}

/** Two saws a fifth apart per note, four unison voices each, a soft attack: a warm, moving bed. */
const PAD_PATCH: Record<string, number> = {
  o1wave: 0, o1oct: 2, o1fine: 0, o1lvl: 0.75, o2wave: 0, o2oct: 2, o2semi: PAD_UPPER_INTERVAL, o2fine: 3, o2lvl: 0.6,
  sub: 0, noise: 0, ring: 0, xmod: 0, uni: 4, spread: 12, width: 0.9, drift: 0.1,
  hpf: 180, cut: 2200, res: 0.08, drive: 0, slope: 1, fenv: 0.15, key: 0.3, fvel: 0.2,
  fa: 0.15, fd: 0.8, fs: 0.6, fr: 0.6, aa: 0.12, ad: 0.6, as: 0.85, ar: 0.6, avel: 0.35, vol: 0.38,
  l1pitch: 0.05, l1rate: 4.5, l1delay: 0.3, l1cut: 0, l1pw: 0, l1amp: 0, mwvib: 0, mwcut: 0, mode: 0, glide: 0, penv: 0,
};

function keysState(): InstrumentState {
  const values: Record<string, number> = {};
  Object.assign(values, leadValues());
  for (const [k, v] of Object.entries(PAD_PATCH)) values[`b.${k}`] = v;
  Object.assign(values, {
    "fx.fxDrive": 0, "fx.fxCrush": 0, "fx.gRate": 0, "fx.chMode": 1, "fx.chMix": 0.45, "fx.phMix": 0,
    // A dotted-eighth ping-pong echo, darkened so the repeats sit behind the dry lead.
    "fx.dlMix": 0.18, "fx.dlDiv": 2, "fx.dlFb": 0.34, "fx.dlTone": 2800, "fx.dlPing": 1,
    "fx.rvMix": 0.26, "fx.rvSize": 1, "fx.rvDamp": 4500, "fx.apDepth": 0, "fx.width": 1.15, "fx.outLvl": 0.6,
    "macro.bright": 0.5, "macro.motion": 0, "macro.space": 0, "macro.grit": 0,
    "seq.mode": 0, "seq.target": 0, "seq.root": 9, "seq.scale": 2, "seq.octave": 3, "seq.dir": 0, "seq.swing": 0,
    "seq.rate": 0, "seq.follow": 0, "seq.evolve": 0, "seq.chain": 0, "seq.layer": PAD_BANK + 1,
    "key.mode": 0, "perf.voices": 24, "perf.tune": 0, "perf.hold": 0,
  });
  return { kind: "galacticOne", values, data: { patterns: keysBanks(), chain: [0], names: ["Hook lead", "Night pad"], active: 0, seed: DEMO_SEED } };
}

function arpState(): InstrumentState {
  return {
    kind: "lead0010110",
    values: {
      root: 9, scale: 8, octave: 3, loop: 3, patGate: 0.5, arpOn: 0, level: 0.55,
      // A soft bell: triangle with a quiet sine an octave up and a low detuned saw for body, through a gentle filter.
      l1on: 1, l1wave: 2, l1oct: 0, l1semi: 0, l1detune: 0, l1level: 0.7,
      l2on: 1, l2wave: 3, l2oct: 1, l2semi: 0, l2detune: 4, l2level: 0.3,
      l3on: 1, l3wave: 0, l3oct: 0, l3semi: 0, l3detune: -9, l3level: 0.16,
      cutoff: 2600, resonance: 0.1, filterEnv: 0.5, attack: 0.003, decay: 0.28, sustain: 0.05, release: 0.35, sub: 0, noise: 0, glide: 0, lfoDepth: 0,
      chorus: 0.35, delay: 0.28, delayTime: 2, delayFb: 0.3, reverb: 0.35, drive: 0, crush: 0, glitchChance: 0, tapeStop: 0,
    },
    data: { steps: ARP_DEGREES, accents: ARP_DEGREES.map((_, i) => i === 0 || i === 9), active: 0, seed: DEMO_SEED, sample: null },
  };
}

function acidState(): InstrumentState {
  return {
    kind: "acid30lee",
    values: {
      wave: 0, octave: 1, tune: 0, cutoff: 300, resonance: 0.35, envMod: 0.45, decay: 180, accent: 0.5, attack: 3, filterMode: 0,
      sub: 0.25, subWave: 1, level: 0.6, drive: 0.12, crush: 0, delay: 0, delayTime: 2, delayFb: 0.2, reverb: 0.08, fxMix: 0.3, fxFilter: 9000, width: 0.3,
      swing: 0.1, slideTime: 70, gate: 0.55, humanise: 0, chance: 1, arpOn: 0,
    },
    data: { patterns: [ACID_STEPS, ACID_STEPS, ACID_STEPS, ACID_STEPS], active: 0, seed: DEMO_SEED },
  };
}

// ----- Mix ------------------------------------------------------------------------------------------

const compressor = (id: string, params: Record<string, number>): Insert => ({ id, type: "compressor", bypass: false, params });
const GLUE = { threshold: -20, ratio: 2.5, attack: 5, release: 140, knee: 8, makeup: 1.5 };
const SOFT = { threshold: -12, ratio: 1.5, attack: 10, release: 200, knee: 12, makeup: 0 };

/**
 * Every browser compressor delays its output by a fixed look-ahead (about 6 ms in Chrome). Divine09 has two inside
 * (glue and safety); PAD-64, 80LA8 and Galactic One have one, 0010110 and 30LEE none. Each track gets compressor
 * inserts up to two in all, so every part lands with the kick. The EQ dips around 2.5 kHz keep a pocket for a voice.
 */
export const DEMO_MIX: Readonly<Record<DemoRole, { gainDb: number; reverb: number; delay: number; pan: number; inserts: Insert[] }>> = {
  drums: { gainDb: -2.8, reverb: 0.05, delay: 0, pan: 0, inserts: [] },
  perc: { gainDb: -8, reverb: 0.08, delay: 0, pan: 0, inserts: [compressor("demo-perc-comp", GLUE)] },
  bass: {
    gainDb: -2.5,
    reverb: 0,
    delay: 0,
    pan: 0,
    inserts: [
      compressor("demo-bass-comp", { threshold: -20, ratio: 3, attack: 3, release: 100, knee: 6, makeup: 2 }),
      // A touch of parallel saturation: harmonics that make the bass audible on small speakers.
      { id: "demo-bass-sat", type: "saturator", bypass: false, params: { drive: 2, tone: 2500, mix: 0.12 } },
    ],
  },
  keys: {
    gainDb: -2.6,
    reverb: 0.12,
    delay: 0,
    pan: 0,
    inserts: [compressor("demo-keys-comp", GLUE), { id: "demo-keys-eq", type: "eq", bypass: false, params: { low: 0, mid: -3, midFreq: 2500, high: -1 } }],
  },
  arp: {
    gainDb: -10,
    reverb: 0.25,
    delay: 0.08,
    pan: 0,
    inserts: [compressor("demo-arp-comp", GLUE), compressor("demo-arp-soft", SOFT), { id: "demo-arp-eq", type: "eq", bypass: false, params: { low: -6, mid: -3, midFreq: 2500, high: -2 } }],
  },
  acid: { gainDb: -14, reverb: 0.05, delay: 0, pan: 0, inserts: [compressor("demo-acid-comp", GLUE), compressor("demo-acid-soft", SOFT)] },
};

// ----- Automation: something moves every few bars --------------------------------------------------------

const beatOf = (bar: number): number => (bar - 1) * 4;
const LIFT_BEAT = LIFT_STEP / 4;

/** Bar positions and values in the parameter's own units; the lane stores them normalised. */
type Sweep = readonly (readonly [bar: number, value: number])[];

/** The pad opens through the intro, brightens into each drop, closes for the break and closes again at the end. */
export const PAD_SWEEP: Sweep = [[1, 900], [9, 2200], [13, 2200], [16.99, 3400], [17, 2200], [33, 1000], [37, 1100], [40.99, 3400], [41, 2400], [57, 2400], [61, 900]];
/** The lead is darker for the teaser and the break, and opens for the final drops. */
export const LEAD_SWEEP: Sweep = [[1, 1200], [17, 1600], [33, 1350], [37, 1450], [41, 1900], [57, 1350]];
/** The rise synth's filter opens over each 4-bar rise. */
export const ACID_SWEEP: Sweep = [[13, 260], [16.99, 2400], [17, 260], [37, 260], [40.99, 2600], [41, 260]];

function lane(id: string, target: string, range: { min: number; max: number }, points: readonly (readonly [beat: number, value: number])[]): AutomationLane {
  return { id, target, points: points.map(([beat, value]) => ({ beat, value: (value - range.min) / (range.max - range.min) })) };
}

const onBars = (sweep: Sweep): [number, number][] => sweep.map(([bar, v]) => [beatOf(bar), v]);
/** A switch at the lift: the value just before it and the new one on it, so nothing passes through in between. */
const atLift = (before: number, after: number): [number, number][] => [[LIFT_BEAT - 0.01, before], [LIFT_BEAT, after]];

function automationFor(role: DemoRole, slotId: string): AutomationLane[] {
  const cutoff = { min: 30, max: 18000 };
  if (role === "keys") {
    return [
      lane("demo-auto-pad-cutoff", `${slotId}.b.cut`, cutoff, onBars(PAD_SWEEP)),
      lane("demo-auto-lead-cutoff", `${slotId}.a.cut`, cutoff, onBars(LEAD_SWEEP)),
      lane("demo-auto-key-lift", `${slotId}.seq.root`, { min: 0, max: 11 }, atLift(9, 11)),
      // The lead's second saw jumps an octave for the final drops: the hook doubled an octave up.
      lane("demo-auto-lead-octave", `${slotId}.a.o2semi`, { min: -12, max: 12 }, atLift(0, 12)),
    ];
  }
  if (role === "arp") return [lane("demo-auto-arp-lift", `${slotId}.root`, { min: 0, max: 11 }, atLift(9, 11))];
  if (role === "acid") return [lane("demo-auto-acid-cutoff", `${slotId}.cutoff`, { min: 80, max: 12000 }, onBars(ACID_SWEEP))];
  return [];
}

// ----- Project ---------------------------------------------------------------------------------------

export const DEMO_KINDS: Readonly<Record<DemoRole, InstrumentKind>> = {
  drums: "divine09",
  perc: "drum80la8",
  bass: "pad64",
  keys: "galacticOne",
  arp: "lead0010110",
  acid: "acid30lee",
};

const ROLES: readonly { key: DemoRole; color: string; state: () => InstrumentState }[] = [
  { key: "drums", color: "#8e7cff", state: drumState },
  { key: "perc", color: "#7cf0c0", state: percState },
  { key: "bass", color: "#79ebff", state: bassState },
  { key: "keys", color: "#ff63d8", state: keysState },
  { key: "arp", color: "#f2c14e", state: arpState },
  { key: "acid", color: "#5fe3a1", state: acidState },
];

export interface DemoMeta {
  id?: string;
  /** Timestamp for createdAt and updatedAt. */
  now?: number;
}

function track(spec: Partial<Track> & Pick<Track, "id" | "name" | "kind" | "color">): Track {
  return { muted: false, solo: false, gainDb: 0, pan: 0, sends: { reverb: 0, delay: 0 }, inserts: [], cue: false, toMaster: true, clips: [], automation: [], ...spec };
}

/** A finished song laid out in both the Song matrix and the Arrange timeline, with an empty Vocal track to sing on. */
export function buildDemoProject(meta: DemoMeta = {}): Project {
  const now = meta.now ?? 0;
  const sections = DEMO_SECTIONS.map((s, i) => ({ id: `demo-sec-${i + 1}`, name: s.name, bars: s.bars, kind: s.kind }));
  const matrix: Record<string, SongPattern[]> = {};
  const levels: Record<string, number> = {};
  const slots: InstrumentSlot[] = [];
  const tracks: Track[] = [];

  for (const role of ROLES) {
    const slotId = `demo-slot-${role.key}`;
    const trackId = `demo-trk-${role.key}`;
    const row = DEMO_SECTIONS.map((s) => s.parts[role.key]);
    matrix[slotId] = row;
    levels[slotId] = 1;
    slots.push({ id: slotId, kind: DEMO_KINDS[role.key], trackId, state: role.state() });
    // The same layout the Song room writes when it sends the song to Arrange, named after the sections.
    const clips = matrixRowToClips(sections, row, 1).map((clip, i) => ({ ...clip, id: `demo-clip-${role.key}-${i}`, name: sectionAt(clip.startBar).name, gainDb: 0 }));
    const mix = DEMO_MIX[role.key];
    tracks.push(
      track({
        id: trackId,
        name: DEMO_TRACKS[role.key],
        kind: "instrument",
        color: role.color,
        slotId,
        gainDb: mix.gainDb,
        pan: mix.pan,
        sends: { reverb: mix.reverb, delay: mix.delay },
        inserts: mix.inserts,
        clips,
        automation: automationFor(role.key, slotId),
      }),
    );
  }
  tracks.push(track({ id: "demo-trk-vocal", name: DEMO_TRACKS.vocal, kind: "audio", color: "#ffd36a", sends: { reverb: 0.18, delay: 0.08 } }));

  const base = newProject(DEMO_NAME);
  const starts = demoSectionStarts();
  const drop = DEMO_SECTIONS.findIndex((s) => s.kind === "drop");
  return {
    ...base,
    id: meta.id ?? "proj-demo",
    createdAt: now,
    updatedAt: now,
    bpm: DEMO_BPM,
    key: DEMO_KEY,
    tracks,
    instruments: slots,
    song: { sections, matrix, levels },
    loop: { on: false, startBar: starts[drop], endBar: starts[drop] + 8 },
  };
}

// ----- The score, for tests that check the rendered audio against what was written --------------------

export interface ScoreNote {
  role: "bass" | "lead" | "pad" | "arp" | "acid";
  /** 16th step from the start of the song. */
  step: number;
  midi: number;
  /** The upper pad note, when the pad's second oscillator adds one. */
  upper?: number;
  bar: number;
  /** For the bass: the bar's root, the next bar's root pushed in early, or a passing note. */
  function?: "root" | "push" | "passing";
}

/** Every pitched note the song should sound, in song order, from the section layout and the written parts. */
export function demoScore(): ScoreNote[] {
  const notes: ScoreNote[] = [];
  const starts = demoSectionStarts();
  DEMO_SECTIONS.forEach((section, i) => {
    if (section.name === "End") return;
    for (let b = 0; b < section.bars; b++) {
      const bar = starts[i] + b;
      const chord = (bar - 1) % 4;
      const barStep = (bar - 1) * STEPS_PER_BAR;
      const { bass, keys, arp, acid } = section.parts;
      if (bass) {
        const lanes = BASS_PATTERNS[bass - 1];
        const roots = bass === 4 ? ROOTS_B : ROOTS_A;
        for (let s = 0; s < 16; s++) {
          BASS_NOTES.forEach((note, laneIndex) => {
            if (!lanes[laneIndex][chord * 16 + s]) return;
            const fn = roots[chord].includes(note) ? "root" : roots[(chord + 1) % 4][0] === note && s === 14 ? "push" : "passing";
            notes.push({ role: "bass", step: barStep + s, midi: midi(note), bar, function: fn });
          });
        }
      }
      if (keys) {
        for (const slot of [...PAD_SLOTS, PAD_PUSH_SLOT]) {
          const step = barStep + slot * 2;
          const written = midi(PAD_NOTES[slot === PAD_PUSH_SLOT ? (chord + 1) % 4 : chord]) + liftAt(step);
          notes.push({ role: "pad", step, midi: written, upper: written + PAD_UPPER_INTERVAL, bar });
        }
        const line = [null, LEAD_LINES.call, LEAD_LINES.answer, LEAD_LINES.teaser][keys - 1]?.[chord];
        line?.forEach((name, slot) => {
          const step = barStep + slot * 2;
          if (name) notes.push({ role: "lead", step, midi: midi(name) + liftAt(step), bar });
        });
      }
      if (arp) ARP_DEGREES.forEach((d, s) => d && notes.push({ role: "arp", step: barStep + s, midi: arpMidi(d) + liftAt(barStep + s), bar }));
      if (acid) ACID_STEPS.forEach((st, s) => notes.push({ role: "acid", step: barStep + s, midi: st.note + st.oct * 12, bar }));
    }
  });
  return notes.sort((a, b) => a.step - b.step || a.midi - b.midi);
}
