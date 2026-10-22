export const VOWELS = ["Ah", "Eh", "Ee", "Oh", "Oo"] as const;
export type Vowel = (typeof VOWELS)[number];

export interface Syllable {
  /** Leading consonant letters, possibly empty. */
  onset: string;
  vowel: Vowel;
  text: string;
}

const VOWEL_OF: Record<string, Vowel> = { a: "Ah", e: "Eh", i: "Ee", y: "Ee", o: "Oh", u: "Oo" };

/** Which vowel a letter group sounds like; digraphs such as "oo" and "ee" are checked before single letters. */
function vowelOf(letters: string): Vowel {
  if (/oo|ou|ue|ew/.test(letters)) return "Oo";
  if (/ee|ea|ie/.test(letters)) return "Ee";
  if (/ai|ay|ey/.test(letters)) return "Eh";
  if (/oa|ow|oh/.test(letters)) return "Oh";
  if (/ah|aa|ar/.test(letters)) return "Ah";
  return VOWEL_OF[letters[0]] ?? "Ah";
}

/** Splits free text into sung syllables: each word is cut after every vowel group, so "frequency" gives "fre", "quen", "cy". */
export function parseLyrics(text: string): Syllable[] {
  const out: Syllable[] = [];
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const groups = word.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]+(?![aeiouy]))?/g) ?? [word];
    for (const group of groups) {
      const split = /^([^aeiouy]*)([aeiouy]+)/.exec(group);
      if (!split) continue;
      out.push({ onset: split[1], vowel: vowelOf(split[2]), text: group });
    }
  }
  return out;
}

export type OnsetKind = "noise" | "glide" | "none";

/** Sibilants and stops start with a burst of filtered noise; liquids and nasals glide into the vowel. */
export function onsetKind(onset: string): OnsetKind {
  if (onset === "") return "none";
  const first = onset[0];
  if ("stkpfhc".includes(first) || onset.startsWith("sh") || onset.startsWith("ch")) return "noise";
  if ("lmnrwyvbdgj".includes(first)) return "glide";
  return "none";
}
