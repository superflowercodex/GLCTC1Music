import type { Preset } from "../../types";
import { PAD_COUNT, emptyPad, synthPad, type PadData } from "./padPlayer";
import type { SynthKind } from "./synthKit";

export const SCENES = 4;

export interface LooperData {
  pads: PadData[];
  /** scenes[s][pad]: whether the pad belongs to scene s (A to D). */
  scenes: boolean[][];
  /** Recorded pad hits, played back on the transport. */
  performance: { pad: number; startStep: number; lengthSteps: number; velocity: number }[];
  performanceSteps: number;
  /** Pads to start on the first bar; used only by bounces so a jam that is playing right now is rendered. */
  launch?: number[];
}

export function emptyScenes(): boolean[][] {
  return Array.from({ length: SCENES }, () => new Array<boolean>(PAD_COUNT).fill(false));
}

function kit(id: string, name: string, kinds: readonly (SynthKind | null)[]): Preset {
  const pads: PadData[] = Array.from({ length: PAD_COUNT }, (_, i) => {
    const kind = kinds[i];
    return kind ? synthPad(kind) : emptyPad();
  });
  // Scenes start empty so a fresh project stays silent on Play until the user puts pads into a scene.
  const data: LooperData = { pads, scenes: emptyScenes(), performance: [], performanceSteps: 16 };
  return { id, name, category: `${kinds.filter(Boolean).length}/16`, factory: true, values: {}, data };
}

/** Factory kits use synthesised sounds so they work with no files and stay out of the project's media. */
export const LOOPER_KITS: readonly Preset[] = [
  kit("kit-cosmic", "Cosmic Lift kit", ["kick", "snare", "clap", "hat", "openhat", "tom", "rim", "perc", "bass", "chords", "riser", "impact", null, null, null, null]),
  kit("kit-drums", "Drum pads", ["kick", "snare", "clap", "hat", "openhat", "tom", "rim", "perc", null, null, null, null, null, null, null, null]),
  kit("kit-jam", "Loop jam", ["bass", "chords", "riser", "impact", "kick", "hat", null, null, null, null, null, null, null, null, null, null]),
  kit("kit-empty", "Empty kit", []),
];
