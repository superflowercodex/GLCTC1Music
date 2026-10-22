import { parseRow } from "./pattern";

/** Pattern text for the 11 synth voices; each string is one 16-step bar. 0 normal, 2 accent are written by the caller. */
export interface DivineGroove {
  id: string;
  name: string;
  kit: number;
  rows: Partial<Record<number, string>>[];
}

export const GROOVES: readonly DivineGroove[] = [
  {
    id: "techno",
    name: "Techno driver",
    kit: 0,
    rows: [
      { 0: "X...x...x...x...", 3: ".x.x.x.x.x.x.x.x", 6: "..........x.....", 7: ".............x..", 8: ".......x.......x", 9: "x...x...x...x...", 10: "x..............." },
      { 0: "x...x...x...x...", 1: "....x.......x...", 2: "............x...", 3: "x.x.x.x.x.x.x.x.", 4: "......x.......x.", 9: "..............x." },
      { 0: "x..x..x...x.....", 1: "....x.........x.", 2: "........x.......", 3: "x..x..x..x..x...", 5: ".......x.......x", 8: "...x.......x...." },
      { 0: "x...x...x...x..x", 1: "....x.......x..x", 2: "....x.......x...", 3: "x.xxx.xxx.xxx.xx", 4: "..x...x...x...x." },
    ],
  },
  {
    id: "house",
    name: "House club",
    kit: 3,
    rows: [
      { 0: "X...X...X...X...", 2: "....x.......x...", 3: "..x...x...x...x.", 4: "..o...o...o...o.", 9: "o.o.o.o.o.o.o.o." },
      { 0: "X...X...X...X...", 1: "....o.......o...", 2: "....x.......x...", 3: "x.xxx.xxx.xxx.xx", 4: "..x...x...x...x." },
    ],
  },
  {
    id: "breaks",
    name: "Breakbeat",
    kit: 8,
    rows: [{ 0: "X.....x...x.....", 1: "....x..o.o..x...", 3: "x.x.x.x.x.x.x.x.", 4: "......x.......x.", 8: "..x.......x....." }],
  },
  {
    id: "electro",
    name: "Electro bounce",
    kit: 6,
    rows: [{ 0: "X.....x...X...x.", 1: "....x.......x...", 2: "....x.......x...", 3: "x.x.x.x.x.x.x.x.", 8: "..x...x...x...x.", 5: "..............x.", 6: ".............x.." }],
  },
  {
    id: "minimal",
    name: "Minimal glitch",
    kit: 10,
    rows: [{ 0: "X.......x.......", 1: "............x...", 3: "..x.x...x.x...x.", 8: ".x.....x..x...x.", 10: "................" }],
  },
  {
    id: "halftime",
    name: "Half-time dub",
    kit: 1,
    rows: [{ 0: "X.......x..x....", 1: "........x.......", 2: "........x.......", 3: "x.x.x.x.x.x.x.x.", 4: "..............x.", 9: "x......." }],
  },
];

/** Expands a groove into 4 patterns of 15 rows by 128 steps (0 off, 1 hit, 2 accent), tiling each bar. */
export function grooveToPatterns(groove: DivineGroove, voices: number, steps: number): number[][][] {
  return Array.from({ length: 4 }, (_, p) =>
    Array.from({ length: voices }, (_, v) => {
      const text = groove.rows[p % groove.rows.length][v];
      const bar = text ? parseRow(text, 1, 2, 1) : new Array<number>(16).fill(0);
      return Array.from({ length: steps }, (_, i) => bar[i % bar.length] ?? 0);
    }),
  );
}
