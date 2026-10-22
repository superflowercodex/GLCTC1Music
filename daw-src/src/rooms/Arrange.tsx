import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { INSTRUMENTS } from "../audio/instruments/registry";
import { startArrangementPlayback } from "../audio/arrangementPlayback";
import { barSeconds } from "../project/actions";
import "../project/history";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { RoomFrame } from "../ui/RoomFrame";
import { AddTrackBar } from "./arrange/AddTrackBar";
import { Inspector } from "./arrange/Inspector";
import { Lane } from "./arrange/Lane";
import { Playhead, Ruler } from "./arrange/Ruler";
import { TrackHeader } from "./arrange/TrackHeader";
import { FooterTools, HeaderTools } from "./arrange/Tools";
import { importAndPlace } from "./arrange/ops";
import { pruneSelection, selectionStore } from "./arrange/selection";
import { arrangeSettings } from "./arrange/settings";
import { gridInBars, pxPerBar, pxToBar, snapBar, visibleBars } from "./arrange/timeline";
import { useArrangeKeys } from "./arrange/useArrangeKeys";
import { useClipDrag } from "./arrange/useClipDrag";
import "./arrange/arrange.css";

const ClipEditor = lazy(() => import("./arrange/editor/ClipEditor"));

const DRUM_KINDS = new Set(["drum80la8", "divine09", "pad64"]);

function hasFiles(e: DragEvent): boolean {
  return [...e.dataTransfer.types].includes("Files");
}

export default function Arrange() {
  const project = useStore(projectStore, (p) => p);
  const { pxPerBeat, snap, gridBeats } = useStore(arrangeSettings, (s) => s);
  const selectedIds = useStore(selectionStore, (s) => s.ids);
  const selectedTrackId = useStore(uiStore, (s) => s.selectedTrackId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const onDrag = useClipDrag();

  // Arrange must be able to play even if the shell has not started it yet; it is a no-op when it has.
  useEffect(() => {
    startArrangementPlayback();
  }, []);

  useEffect(() => projectStore.subscribe(pruneSelection), []);

  const clipCount = project.tracks.reduce((n, t) => n + t.clips.length, 0);
  const editingExists = editingId !== null && project.tracks.some((t) => t.clips.some((c) => c.id === editingId));
  useEffect(() => {
    if (editingId !== null && !editingExists) setEditingId(null);
  }, [editingId, editingExists, clipCount]);

  const editingRef = useRef(editingId);
  editingRef.current = editingId;
  const closeEditor = useCallback((): boolean => {
    if (editingRef.current === null) return false;
    setEditingId(null);
    return true;
  }, []);
  useArrangeKeys(closeEditor);

  const { beatsPerBar } = project;
  const ppb = pxPerBar(pxPerBeat, beatsPerBar);
  const bars = visibleBars(project);
  const barSec = barSeconds(project);
  const selectedClips = project.tracks.flatMap((t) => t.clips).filter((c) => selectedIds.includes(c.id));
  const slotByTrack = new Map(project.instruments.map((s) => [s.trackId, s.kind]));

  const subtitle = (trackId: string, kind: string, clips: number): string => {
    const slotKind = slotByTrack.get(trackId);
    const info = slotKind ? INSTRUMENTS.find((i) => i.kind === slotKind) : undefined;
    if (info) return `${info.name} · ${info.section === "Drums" ? "Drums" : "Synth"}`;
    const label = kind === "video" ? "Video" : kind === "fx" ? "FX" : "Audio";
    return clips > 0 ? `${label} · ${clips} clip${clips === 1 ? "" : "s"}` : label;
  };

  const onDragOver = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDrop = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    const lane = (e.target as HTMLElement).closest<HTMLElement>("[data-lane]");
    let at: { trackId?: string; startBar?: number } | undefined;
    if (lane) {
      const rect = lane.getBoundingClientRect();
      at = { trackId: lane.dataset.lane, startBar: snapBar(pxToBar(e.clientX - rect.left, ppb), gridInBars(gridBeats, beatsPerBar), snap) };
    }
    void importAndPlace(files, at);
  };

  return (
    <RoomFrame eyebrow={project.name} title="Arrange" actions={<HeaderTools />} footerExtra={<FooterTools />}>
      <div className={`arr-body${editingExists ? " editing" : ""}`}>
        <div className="arr-fill">
          <section
            className="panel arr-panel"
            aria-label="Arrangement"
            onDragOver={onDragOver}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
            }}
            onDrop={onDrop}
          >
            <div className="arr-scroll" ref={scroller}>
              <div className="arr-canvas" style={{ width: `calc(var(--head-w) + ${bars * ppb}px)` }}>
                <div className="arr-ruler">
                  <div className="arr-corner">Tracks</div>
                  <Ruler bars={bars} ppb={ppb} loop={project.loop} />
                </div>
                {project.tracks.map((track, i) => (
                  <div className="arr-row" key={track.id}>
                    <TrackHeader
                      track={track}
                      subtitle={subtitle(track.id, track.kind, track.clips.length)}
                      selected={track.id === selectedTrackId}
                      index={i}
                      count={project.tracks.length}
                    />
                    <Lane
                      track={track}
                      ppb={ppb}
                      pxPerBeat={pxPerBeat}
                      beatsPerBar={beatsPerBar}
                      barSec={barSec}
                      bpm={project.bpm}
                      assets={project.assets}
                      drums={DRUM_KINDS.has(slotByTrack.get(track.id) ?? "")}
                      selectedIds={selectedIds}
                      snapOn={snap}
                      gridBars={gridInBars(gridBeats, beatsPerBar)}
                      onDrag={onDrag}
                      onOpen={setEditingId}
                    />
                  </div>
                ))}
                {project.tracks.length === 0 && (
                  <div className="arr-empty">
                    <strong>Nothing here yet</strong>
                    <span>Add a track below, or drop audio, video or images anywhere on this panel.</span>
                  </div>
                )}
                <div className="arr-addrow">
                  <AddTrackBar />
                </div>
                {selectedClips.length > 0 && <div className="arr-spacer" />}
                <Playhead ppb={ppb} beatsPerBar={beatsPerBar} scroller={scroller} />
              </div>
            </div>
            {selectedClips.length > 0 && <Inspector project={project} clips={selectedClips} tracks={project.tracks} onOpenEditor={setEditingId} />}
            {dropping && (
              <div className="arr-drop" aria-hidden="true">
                Drop to add to your project
              </div>
            )}
          </section>
          {editingExists && editingId && (
            <div className="arr-drawer">
              <Suspense fallback={<div className="panel">Opening the editor…</div>}>
                <ClipEditor clipId={editingId} onClose={() => setEditingId(null)} />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </RoomFrame>
  );
}
