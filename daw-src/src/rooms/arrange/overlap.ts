import { clipEndBar, findClip, moveClips } from "../../project/actions";
import type { Clip, Project } from "../../project/model";

export interface OverlapSpan {
  startBar: number;
  endBar: number;
}

const EPS = 1e-6;

/** Where clips on one track cover each other, merged into separate spans. */
export function overlapSpans(clips: readonly Pick<Clip, "startBar" | "lengthBars">[]): OverlapSpan[] {
  const raw: OverlapSpan[] = [];
  for (let i = 0; i < clips.length; i++) {
    for (let j = i + 1; j < clips.length; j++) {
      const startBar = Math.max(clips[i].startBar, clips[j].startBar);
      const endBar = Math.min(clipEndBar(clips[i]), clipEndBar(clips[j]));
      if (endBar - startBar > EPS) raw.push({ startBar, endBar });
    }
  }
  raw.sort((a, b) => a.startBar - b.startBar);
  const merged: OverlapSpan[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.startBar <= last.endBar + EPS) last.endBar = Math.max(last.endBar, s.endBar);
    else merged.push({ ...s });
  }
  return merged;
}

/** True when any of `ids` covers a clip that is not in `ids` on the same track. */
export function movedOverlap(project: Project, ids: ReadonlySet<string>): boolean {
  for (const t of project.tracks) {
    const moved = t.clips.filter((c) => ids.has(c.id));
    if (moved.length === 0) continue;
    const others = t.clips.filter((c) => !ids.has(c.id));
    for (const m of moved) for (const o of others) if (Math.min(clipEndBar(m), clipEndBar(o)) - Math.max(m.startBar, o.startBar) > EPS) return true;
  }
  return false;
}

/**
 * The shift nearest to `deltaBars` that lands the clips without covering any other clip, for the
 * "Avoid overlaps" mode. Candidates butt a moved clip against a neighbour's start or end; when nothing
 * fits (a track with no room), the wanted shift is returned unchanged.
 */
export function freeDelta(project: Project, clipIds: readonly string[], deltaBars: number, deltaTracks: number): number {
  const ids = new Set(clipIds);
  const located = clipIds.map((id) => findClip(project, id)).filter((l) => l !== undefined);
  if (located.length === 0) return deltaBars;
  const minStart = Math.min(...located.map((l) => l.clip.startBar));
  const fits = (d: number): boolean => d >= 1 - minStart - EPS && !movedOverlap(moveClips(project, clipIds, { deltaBars: d, deltaTracks }), ids);
  if (fits(deltaBars)) return deltaBars;
  // Where each moved clip lands with the wanted shift, to know which neighbours it can butt against.
  const landed = moveClips(project, clipIds, { deltaBars: 0, deltaTracks });
  const candidates = new Set<number>();
  for (const t of landed.tracks) {
    const moved = t.clips.filter((c) => ids.has(c.id));
    const others = t.clips.filter((c) => !ids.has(c.id));
    for (const m of moved) {
      for (const o of others) {
        candidates.add(clipEndBar(o) - m.startBar);
        candidates.add(o.startBar - clipEndBar(m));
      }
    }
  }
  const ordered = [...candidates].sort((a, b) => Math.abs(a - deltaBars) - Math.abs(b - deltaBars));
  return ordered.find(fits) ?? deltaBars;
}
