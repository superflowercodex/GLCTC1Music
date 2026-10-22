import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Instrument, InstrumentKind } from "../types";

export interface InstrumentInfo {
  kind: InstrumentKind;
  name: string;
  tagline: string;
  meta: string;
  color: string;
  section: "Drums" | "Synths" | "Voice and samples";
  /** Loaded on demand so the first screen does not pay for engines nobody opened. */
  create: (ctx: BaseAudioContext) => Promise<Instrument>;
  Room: LazyExoticComponent<ComponentType<{ instrument: Instrument }>>;
}

export const INSTRUMENTS: readonly InstrumentInfo[] = [
  {
    kind: "drum80la8",
    name: "80LA8",
    tagline: "Drum machine with live tap pads",
    meta: "12 voices · 4 patterns · swing",
    color: "#79ebff",
    section: "Drums",
    create: async (ctx) => new (await import("./drum80la8")).Drum80la8(ctx),
    Room: lazy(() => import("../../rooms/instrument/surfaces/Drum80la8Room")),
  },
  {
    kind: "divine09",
    name: "Divine09",
    tagline: "909-inspired drum engine",
    meta: "15 voices · 12 kits · up to 128 steps",
    color: "#8e7cff",
    section: "Drums",
    create: async (ctx) => new (await import("./divine09")).Divine09(ctx),
    Room: lazy(() => import("../../rooms/instrument/surfaces/Divine09Room")),
  },
  {
    kind: "pad64",
    name: "PAD-64",
    tagline: "Sample pads with a 64-step sequencer",
    meta: "16 synth voices · accents · 4 patterns",
    color: "#ff63d8",
    section: "Drums",
    create: async (ctx) => new (await import("./pad64")).Pad64(ctx),
    Room: lazy(() => import("../../rooms/instrument/surfaces/Pad64Room")),
  },
  {
    kind: "acid30lee",
    name: "30LEE",
    tagline: "Acid bass with arpeggiator",
    meta: "4 patterns · filter freeze",
    color: "#8e7cff",
    section: "Synths",
    create: async (ctx) => new (await import("./acid30lee")).Acid30lee(ctx),
    Room: lazy(() => import("../../rooms/instrument/surfaces/Acid30leeRoom")),
  },
  {
    kind: "lead0010110",
    name: "0010110",
    tagline: "Three-oscillator lead synth",
    meta: "Layers · arp with latch · sample layer",
    color: "#ff63d8",
    section: "Synths",
    create: async (ctx) => new (await import("./lead0010110")).Lead0010110(ctx),
    Room: lazy(() => import("../../rooms/instrument/surfaces/Lead0010110Room")),
  },
  {
    kind: "galacticOne",
    name: "Galactic One",
    tagline: "Full workstation synth",
    meta: "36 presets · mod matrix · 8 pattern banks",
    color: "#79ebff",
    section: "Synths",
    create: async (ctx) => new (await import("./galacticOne")).GalacticOne(ctx),
    Room: lazy(() => import("../../rooms/instrument/surfaces/GalacticOneRoom")),
  },
  {
    kind: "vox",
    name: "Galactic Vox",
    tagline: "Vocal studio with auto-tune and a choir",
    meta: "Harmoniser · vocoder · 19 vocal presets",
    color: "#7cf0c0",
    section: "Voice and samples",
    create: async (ctx) => new (await import("./vox")).Vox(ctx),
    Room: lazy(() => import("../../rooms/instrument/surfaces/VoxRoom")),
  },
  {
    kind: "looper",
    name: "Looper",
    tagline: "16 sampler pads for loops and one-shots",
    meta: "Loop · one-shot · hold · bounce",
    color: "#ffd36a",
    section: "Voice and samples",
    create: async (ctx) => new (await import("./looper")).Looper(ctx),
    Room: lazy(() => import("../../rooms/instrument/surfaces/LooperRoom")),
  },
];

export function instrumentInfo(kind: InstrumentKind): InstrumentInfo {
  const info = INSTRUMENTS.find((i) => i.kind === kind);
  if (!info) throw new RangeError(`Unknown instrument "${kind}"`);
  return info;
}
