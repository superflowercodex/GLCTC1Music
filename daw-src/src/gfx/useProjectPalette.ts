import { useMemo } from "react";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { projectPalette, type Palette } from "./palette";

/** The open project's accent palette; recomputed only when a track colour or the project changes. */
export function useProjectPalette(): Palette {
  // The music decides the colour: tracks that hold clips speak first; empty ones only when nothing has clips yet.
  const colors = useStore(projectStore, (p) => {
    const used = p.tracks.filter((t) => t.clips.length > 0);
    return (used.length > 0 ? used : p.tracks).map((t) => t.color).join(" ");
  });
  const id = useStore(projectStore, (p) => p.id);
  return useMemo(() => projectPalette(colors ? colors.split(" ") : [], id), [colors, id]);
}
