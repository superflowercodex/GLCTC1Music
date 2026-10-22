import { parseRow } from "./pattern";

/** Twelve voices in the order of VOICES_80LA8, 16 velocities each; written as text for readability. */
const pat = (rows: Partial<Record<number, string>>): number[][] => Array.from({ length: 12 }, (_, v) => parseRow(rows[v] ?? "................"));

export type Pattern80 = number[][];

export interface Groove {
  name: string;
  patterns: [Pattern80, Pattern80, Pattern80, Pattern80];
}

/** The four patterns the old DAW shipped, kept so existing users find their grooves. */
export const CLASSIC: Groove = {
  name: "Classic",
  patterns: [
    pat({ 0: "x...x...x...x...", 1: "....x.......x...", 2: "....x.......x...", 3: "x.x.x.x.x.x.x.x.", 4: "..x...x...x...x.", 5: "...x.......x...." }),
    pat({ 0: "x...x...x...x...", 1: "....x.......x...", 2: "..x...x...x...x.", 3: "x.x.x.x.x.x.x.xx", 4: "x...x...x...x...", 9: "..x...x...x...x." }),
    pat({ 0: "x.......x.......", 1: "............x...", 2: "....x.......x...", 3: "..x...x...x...x.", 4: ".......x.......x" }),
    pat({ 0: "x...x...x...x...", 1: "....x.......x...", 2: "...x...x...x...x", 3: "x.x.x.x.x.x.x.x.", 4: "......xx......xx", 5: "..........xx..xx", 6: "..x...x...x...x.", 7: ".......x.......x" }),
  ],
};

export const HOUSE: Groove = {
  name: "House",
  patterns: [
    pat({ 0: "X...X...X...X...", 2: "....x.......x...", 3: "..x...x...x...x.", 4: "..o...o...o...o.", 9: "o.o.o.o.o.o.o.o." }),
    pat({ 0: "X...X...X...X...", 2: "....x.......x...", 3: "x.xxx.xxx.xxx.xx", 4: "..x...x...x...x.", 8: "...x.......x...." }),
    pat({ 0: "X...X...X...X..x", 1: "....o.......o...", 2: "....x.......x...", 3: "..x...x...x...x.", 9: "o...o...o...o..." }),
    pat({ 0: "X...X...X...X...", 2: "....x.......x.xx", 3: "xxxxxxxxxxxxxxxx", 4: "..x...x...x...x.", 5: "...........x.x.x" }),
  ],
};

export const TRAP: Groove = {
  name: "Trap",
  patterns: [
    pat({ 0: "X.....x...x.....", 1: "........x.......", 2: "........x.......", 3: "x.x.x.x.x.x.x.x.", 4: "...............x" }),
    pat({ 0: "X.......x.x.....", 1: "........x.......", 3: "xxx.xxx.xxx.xxx.", 4: "......x.......x.", 7: "..............x." }),
    pat({ 0: "X..x..x.....x...", 1: "........x.......", 2: "........x...x...", 3: "x.xxx.x.x.xxx.xx", 4: "..x.....x.......", 10: "o.o.o.o.o.o.o.o." }),
    pat({ 0: "X.......X.......", 1: "........x.x.x.xx", 3: "xxxxxxxxxxxxxxxx", 4: "x.......x.......", 5: "..............xx" }),
  ],
};

export const BREAKS: Groove = {
  name: "Breaks",
  patterns: [
    pat({ 0: "X.....x...x.....", 1: "....x..o.o..x...", 3: "x.x.x.x.x.x.x.x.", 4: "......x.......x." }),
    pat({ 0: "X..x..x.....x...", 1: "....x.o.....x..o", 2: "....x.......x...", 3: "x.xxx.x.x.xxx.x.", 4: "x.......x.......", 7: "..x.......x....." }),
    pat({ 0: "X...x.....x.....", 1: "....x.......xo.o", 3: "x.x.x.x.x.x.x.x.", 4: ".....x.....x...x", 9: "...x.......x...." }),
    pat({ 0: "X.x...x...x.x...", 1: "....x..x....x.xx", 2: "..............x.", 3: "xxxxxxxxxxxxxxxx", 5: "..........x.x.x.", 6: ".............x.x" }),
  ],
};

export const ELECTRO: Groove = {
  name: "Electro",
  patterns: [
    pat({ 0: "X.....x...X...x.", 1: "....x.......x...", 2: "....x.......x...", 3: "x.x.x.x.x.x.x.x.", 8: "..x...x...x...x." }),
    pat({ 0: "X..x..x...X..x..", 1: "....x.......x...", 3: "x.xxx.xxx.xxx.xx", 4: "..x.......x.....", 7: ".x...x...x...x.." }),
    pat({ 0: "X...X..x..X.....", 1: "....x.......x..x", 2: "....x.......x...", 3: "..x...x...x...x.", 10: "x...x...x...x...", 11: "..x...x...x...x." }),
    pat({ 0: "X.x.X.x.X.x.X.x.", 1: "....x.......xxxx", 3: "xxxxxxxxxxxxxxxx", 5: "............x.x.", 6: "..............xx", 9: "x..x..x..x..x..x" }),
  ],
};
