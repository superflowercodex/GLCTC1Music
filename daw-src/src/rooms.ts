import type { InstrumentKind } from "./audio/types";

export type RoomId = "arrange" | "play" | "mix" | "song" | "stage" | "library";

export interface Room {
  id: RoomId;
  label: string;
  title: string;
}

export const ROOMS: readonly Room[] = [
  { id: "arrange", label: "Arrange", title: "Arrange" },
  { id: "play", label: "Play", title: "Instruments" },
  { id: "mix", label: "Mix", title: "Mixer" },
  { id: "song", label: "Song", title: "Song" },
  { id: "stage", label: "Stage", title: "Stage" },
  { id: "library", label: "Library", title: "Library" },
];

export interface Route {
  room: RoomId;
  /** Second path segment: an instrument kind inside the Play room. */
  sub?: string;
}

// Hash routing because GitHub Pages cannot rewrite unknown paths to index.html.
export function parseRoute(hash: string): Route {
  const [id, sub] = hash.replace(/^#\/?/, "").split("/");
  const room = ROOMS.find((r) => r.id === id)?.id ?? "arrange";
  return { room, sub: sub || undefined };
}

export function roomFromHash(hash: string): RoomId {
  return parseRoute(hash).room;
}

export function instrumentHref(kind: InstrumentKind): string {
  return `#/play/${kind}`;
}
