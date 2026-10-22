export type IconName =
  | "play"
  | "pause"
  | "stop"
  | "record"
  | "loop"
  | "rewind"
  | "back"
  | "next"
  | "plus"
  | "close"
  | "search"
  | "undo"
  | "redo"
  | "trash"
  | "arrange"
  | "pads"
  | "mixer"
  | "song"
  | "stage"
  | "library"
  | "fullscreen";

const PATHS: Record<IconName, { d: string; fill?: boolean; extra?: string }> = {
  play: { d: "M8 5l11 7-11 7z", fill: true },
  pause: { d: "M7 5h4v14H7zM13 5h4v14h-4z", fill: true },
  stop: { d: "M6 6h12v12H6z", fill: true },
  record: { d: "M12 6a6 6 0 100 12 6 6 0 000-12z", fill: true },
  loop: { d: "M17 3l3 3-3 3M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 01-3 3H4" },
  rewind: { d: "M6 5h2v14H6zM19 5v14L9 12z", fill: true },
  back: { d: "M15 5l-7 7 7 7" },
  next: { d: "M9 5l7 7-7 7" },
  plus: { d: "M12 5v14M5 12h14" },
  close: { d: "M6 6l12 12M18 6L6 18" },
  search: { d: "M20 20l-4-4", extra: "circle:11,11,7" },
  undo: { d: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" },
  redo: { d: "M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" },
  trash: { d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" },
  arrange: { d: "M4 7h10M4 12h16M4 17h7" },
  pads: { d: "", extra: "rects" },
  mixer: { d: "M7 4v16M12 4v16M17 4v16" },
  song: { d: "M9 17V5l10-2v12", extra: "circle:7,17,2;circle:17,15,2" },
  stage: { d: "M10 9.5l5 2.5-5 2.5z", extra: "rect:3,5,18,14,3" },
  library: { d: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  fullscreen: { d: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" },
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const spec = PATHS[name];
  const parts = spec.extra?.split(";") ?? [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={spec.fill ? "currentColor" : "none"}
      stroke={spec.fill ? "none" : "currentColor"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {spec.d && <path d={spec.d} />}
      {spec.extra === "rects" && (
        <>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </>
      )}
      {parts.map((p) => {
        const [kind, args] = p.split(":");
        const n = args?.split(",").map(Number) ?? [];
        if (kind === "circle") return <circle key={p} cx={n[0]} cy={n[1]} r={n[2]} />;
        if (kind === "rect") return <rect key={p} x={n[0]} y={n[1]} width={n[2]} height={n[3]} rx={n[4]} />;
        return null;
      })}
    </svg>
  );
}
