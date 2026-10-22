import type { CSSProperties } from "react";
import type { Palette } from "./palette";

export interface CoverLane {
  color: string;
  /** Clips as [left %, width %] of the arrangement. */
  clips: ReadonlyArray<readonly [number, number]>;
}

/**
 * A project's cover: an aurora of its three accents with a soft light ring, and (when there is room) its
 * arrangement drawn as glowing lanes, the way an album sleeve carries the record's mood. Pure CSS, so it
 * scales from a 40px transport thumb to the Library hero.
 */
export function Cover({ palette, lanes, className = "", playing }: { palette: Palette; lanes?: readonly CoverLane[]; className?: string; playing?: boolean }) {
  const style = { "--c1": palette.a1, "--c2": palette.a2, "--c3": palette.a3 } as CSSProperties;
  return (
    <div className={`cover ${playing ? "is-playing" : ""} ${className}`} style={style} aria-hidden="true">
      <span className="cover-ring" />
      {lanes && lanes.length > 0 && (
        <div className="cover-lanes">
          {lanes.map((l, i) => (
            <div key={i} className="cover-lane" style={{ "--k": l.color } as CSSProperties}>
              {l.clips.map(([left, width], j) => (
                <i key={j} style={{ left: `${left}%`, width: `${width}%` }} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lanes for a cover from a project's tracks: up to `max` tracks, clips placed across the song's length. */
export function coverLanes(tracks: ReadonlyArray<{ color: string; clips: ReadonlyArray<{ startBar: number; lengthBars: number }> }>, max = 6): CoverLane[] {
  const shown = tracks.filter((t) => t.clips.length > 0).slice(0, max);
  const end = Math.max(8, ...shown.flatMap((t) => t.clips.map((c) => c.startBar - 1 + c.lengthBars)));
  return shown.map((t) => ({
    color: t.color,
    clips: t.clips.map((c) => [((c.startBar - 1) / end) * 100, Math.max(1.5, (c.lengthBars / end) * 100)] as const),
  }));
}
