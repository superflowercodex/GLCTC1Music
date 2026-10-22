import { memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { clipRate } from "../../project/actions";
import type { Asset, Clip, Track } from "../../project/model";
import { uiStore } from "../../store/project";
import { ClipArt } from "./ClipArt";
import { addPatternClip, seekToBar } from "./ops";
import { selectClips } from "./selection";
import { pxToBar, snapBar } from "./timeline";
import type { DragMode } from "./useClipDrag";

interface ClipViewProps {
  clip: Clip;
  color: string;
  selected: boolean;
  ppb: number;
  pxPerBeat: number;
  beatsPerBar: number;
  rate: number;
  barSec: number;
  drums: boolean;
  assetName: string | undefined;
  onDrag: (e: ReactPointerEvent, clip: Clip, mode: DragMode) => void;
  onOpen: (clipId: string) => void;
}

const KIND_LABEL: Record<Clip["kind"], string> = {
  audio: "Audio clip",
  pattern: "Pattern clip",
  midi: "MIDI clip",
  video: "Video clip",
  image: "Image clip",
};

const ClipView = memo(function ClipView({
  clip,
  color,
  selected,
  ppb,
  pxPerBeat,
  beatsPerBar,
  rate,
  barSec,
  drums,
  assetName,
  onDrag,
  onOpen,
}: ClipViewProps) {
  const left = (clip.startBar - 1) * ppb + 2;
  const width = Math.max(8, clip.lengthBars * ppb - 4);
  const spb = beatsPerBar * 4;
  const fadeIn = (clip.fadeInSteps / spb) * ppb;
  const fadeOut = (clip.fadeOutSteps / spb) * ppb;
  const visual = clip.kind === "video" || clip.kind === "image";
  const editable = clip.kind !== "video" && clip.kind !== "image";
  const edgeDrag = (e: ReactPointerEvent, mode: DragMode): void => {
    e.stopPropagation();
    onDrag(e, clip, mode);
  };
  return (
    <div
      className={`clip k-${clip.kind}${selected ? " sel" : ""}`}
      style={{ left, width, "--c": color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`${KIND_LABEL[clip.kind]} ${clip.name}, bar ${clip.startBar.toFixed(2).replace(/\.?0+$/, "")}`}
      aria-pressed={selected}
      data-clip={clip.id}
      onPointerDown={(e) => onDrag(e, clip, "move")}
      onDoubleClick={() => editable && onOpen(clip.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          selectClips([clip.id]);
          if (editable) onOpen(clip.id);
        }
      }}
    >
      <span className="clip-name">{clip.name}</span>
      {clip.kind === "pattern" && <span className="clip-badge">{String.fromCharCode(65 + (clip.patternIndex ?? 0))}</span>}
      {!visual && (
        <ClipArt
          clip={clip}
          rate={rate}
          barSec={barSec}
          beatsPerBar={beatsPerBar}
          color={color}
          drums={drums}
          pxPerBeat={pxPerBeat}
          assetName={assetName}
        />
      )}
      {fadeIn > 1 && <span className="fade fade-in" style={{ width: fadeIn }} />}
      {fadeOut > 1 && <span className="fade fade-out" style={{ width: fadeOut }} />}
      {width >= 28 && (
        <>
          <span className="clip-h l" aria-hidden="true" onPointerDown={(e) => edgeDrag(e, "start")} />
          <span className="clip-h r" aria-hidden="true" onPointerDown={(e) => edgeDrag(e, "end")} />
        </>
      )}
    </div>
  );
});

interface LaneProps {
  track: Track;
  ppb: number;
  pxPerBeat: number;
  beatsPerBar: number;
  barSec: number;
  bpm: number;
  assets: readonly Asset[];
  drums: boolean;
  selectedIds: readonly string[];
  snapOn: boolean;
  gridBars: number;
  onDrag: (e: ReactPointerEvent, clip: Clip, mode: DragMode) => void;
  onOpen: (clipId: string) => void;
}

export const Lane = memo(function Lane({
  track,
  ppb,
  pxPerBeat,
  beatsPerBar,
  barSec,
  bpm,
  assets,
  drums,
  selectedIds,
  snapOn,
  gridBars,
  onDrag,
  onOpen,
}: LaneProps) {
  const atPointer = (e: { clientX: number; currentTarget: HTMLElement }): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return snapBar(pxToBar(e.clientX - rect.left, ppb), gridBars, snapOn);
  };
  return (
    <div
      className={`arr-lane${track.muted ? " muted" : ""}`}
      data-lane={track.id}
      style={{ "--ppb": `${ppb}px`, "--beat": `${ppb / beatsPerBar}px` } as CSSProperties}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        uiStore.set((s) => ({ ...s, selectedTrackId: track.id }));
        if (!e.shiftKey) selectClips([]);
        seekToBar(atPointer(e));
      }}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget && track.kind === "instrument") addPatternClip(track.id, atPointer(e));
      }}
    >
      {track.clips.map((clip) => (
        <ClipView
          key={clip.id}
          clip={clip}
          color={track.color}
          selected={selectedIds.includes(clip.id)}
          ppb={ppb}
          pxPerBeat={pxPerBeat}
          beatsPerBar={beatsPerBar}
          rate={clipRate({ bpm, assets }, clip)}
          barSec={barSec}
          drums={drums}
          assetName={clip.assetId ? assets.find((a) => a.id === clip.assetId)?.name : undefined}
          onDrag={onDrag}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
});
