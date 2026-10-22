export function MetronomeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 21h8l-1.6-15h-4.8z" />
      <path d="M12 17L16 8" />
      <circle cx="15" cy="10.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function ZoomIcon({ plus, size = 22 }: { plus: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2M8.5 11h5" />
      {plus && <path d="M11 8.5v5" />}
    </svg>
  );
}

export type TrackIconKind = "audio" | "midi" | "drums" | "video" | "fx";

const KIND_TITLE: Record<TrackIconKind, string> = { audio: "Audio track", midi: "MIDI track", drums: "Drum track", video: "Video track", fx: "FX track" };

/** Small glyph that says what a track holds, so rows do not need a text label for it. */
export function KindIcon({ kind, size = 18 }: { kind: TrackIconKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={KIND_TITLE[kind]}>
      <title>{KIND_TITLE[kind]}</title>
      {kind === "audio" && <path d="M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4M22 12h-1" />}
      {kind === "midi" && <path d="M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM19 16a3 3 0 11-6 0 3 3 0 016 0z" />}
      {kind === "drums" && <path d="M4 10c0-2 3.6-3 8-3s8 1 8 3-3.6 3-8 3-8-1-8-3zM4 10v6c0 2 3.6 3 8 3s8-1 8-3v-6M16 3l-3 5M8 3l3 5" />}
      {kind === "video" && <path d="M4 6h11a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM16 10l5-3v10l-5-3" />}
      {kind === "fx" && <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />}
    </svg>
  );
}
