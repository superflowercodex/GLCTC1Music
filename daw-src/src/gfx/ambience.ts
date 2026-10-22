import type { Route } from "../rooms";
import { mixHex, type Palette } from "./palette";
import { sceneFor, type SceneId } from "./sky";

export interface Ambience {
  /** Hex colour of the room's own nebula pool. */
  accent: string;
  /** Where that pool sits, in 0..1 screen space with y up (the shader's frame). */
  focus: [number, number];
  /** The two big nebula pools, in the project's second and third accent. */
  pools?: [string, string];
  /** The room's own sky character (ribbons, shafts, clouds, deep, dust, device). */
  scene: SceneId;
  /** The project's palette, which the sky walks through over minutes. */
  palette?: Palette;
}

/** How far a room leans the project's accent toward its own hue: enough to feel the move, not to lose the project. */
export const ROOM_LEAN = 0.22;

// Each room leans the nebula toward its own colour and corner, so moving between rooms feels like the
// light drifting rather than a page swap. Instruments use their own colour, lit above the device so it shows around the title and the plates.
const ROOM_AMBIENCE: Record<Route["room"], Omit<Ambience, "scene">> = {
  arrange: { accent: "#79ebff", focus: [0.56, 0.9] },
  mix: { accent: "#8e7cff", focus: [0.55, 0.82] },
  song: { accent: "#ff63d8", focus: [0.72, 0.7] },
  stage: { accent: "#f2c14e", focus: [0.62, 0.3] },
  library: { accent: "#8e7cff", focus: [0.42, 0.22] },
  play: { accent: "#ff63d8", focus: [0.5, 0.55] },
};

export function ambienceFor(route: Route, instrumentColor?: string, palette?: Palette): Ambience {
  const pools: [string, string] | undefined = palette ? [palette.a2, palette.a3] : undefined;
  const scene = sceneFor(route, !!instrumentColor);
  if (route.room === "play" && instrumentColor) return { accent: instrumentColor, focus: [0.5, 0.94], pools, scene, palette };
  const room = ROOM_AMBIENCE[route.room];
  return palette ? { ...room, accent: roomAccent(route, palette), pools, scene, palette } : { ...room, scene };
}

/** The project's main accent, leaned a little toward the room's own colour. */
export function roomAccent(route: Route, palette: Palette): string {
  return mixHex(palette.a1, ROOM_AMBIENCE[route.room].accent, ROOM_LEAN);
}
