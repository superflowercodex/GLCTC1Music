import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { INSTRUMENTS } from "../audio/instruments/registry";
import { startArrangementPlayback } from "../audio/arrangementPlayback";
import { barSeconds, timelineEndBar } from "../project/actions";
import "../project/history";
import type { Clip, Project } from "../project/model";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { RoomFrame } from "../ui/RoomFrame";
import { InfoChip, BPM_CHIP_SLOT } from "../ui/controls";
import { ProjectHeader } from "../ui/ProjectHeader";
import { AddTrackBar } from "./arrange/AddTrackBar";
import { Inspector } from "./arrange/Inspector";
import { ClipModal } from "./arrange/ClipModal";
import { HScrollBar } from "./arrange/HScrollBar";
import { Lane, laneVars } from "./arrange/Lane";
import { Playhead, Ruler } from "./arrange/Ruler";
import { TrackHeader } from "./arrange/TrackHeader";
import { FooterTools, HeaderTools } from "./arrange/Tools";
import { importAndPlace } from "./arrange/ops";
import { fadeEdges } from "../ui/useEdgeFade";
import { clampHeadWidth, HEAD_W } from "./arrange/timeline";
import { TrackBar } from "./arrange/TrackBar";
import { useMarquee } from "./arrange/useMarquee";
import { pruneSelection, selectionStore } from "./arrange/selection";
import { lsGet, lsSet } from "../storage";
import { arrangeSettings, setZoom } from "./arrange/settings";
import type { TrackIconKind } from "./arrange/icons";
import { fitZoom, gridInBars, pxPerBar, pxToBar, snapBar, songBars, visibleBars } from "./arrange/timeline";
import { useArrangeKeys } from "./arrange/useArrangeKeys";
import { useClipDrag } from "./arrange/useClipDrag";
import "./arrange/patternLive";
import "./arrange/arrange.css";

const ClipEditor = lazy(() => import("./arrange/editor/ClipEditor"));

const DRUM_KINDS = new Set(["drum80la8", "divine09", "pad64"]);

/** Pattern clips on one track playing one pattern can share the editor; anything else is a mixed selection. */
function samePattern(project: Project, clips: readonly Clip[]): boolean {
  if (!clips.every((c) => c.kind === "pattern" && (c.patternIndex ?? 0) === (clips[0].patternIndex ?? 0))) return false;
  const track = (c: Clip) => project.tracks.find((t) => t.clips.includes(c))?.id;
  return clips.every((c) => track(c) === track(clips[0]));
}

function hasFiles(e: DragEvent): boolean {
  return [...e.dataTransfer.types].includes("Files");
}

export default function Arrange() {
  const project = useStore(projectStore, (p) => p);
  const { pxPerBeat, snap, gridBeats } = useStore(arrangeSettings, (s) => s);
  const selectedIds = useStore(selectionStore, (s) => s.ids);
  const selectedTrackId = useStore(uiStore, (s) => s.selectedTrackId);
  const selectedTrackIds = useStore(selectionStore, (s) => s.trackIds);
  const [headW, setHeadW] = useState(() => clampHeadWidth(lsGet("arrange.headW", HEAD_W.default)));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const { band, start: onBackdrop } = useMarquee(scroller, grid);
  const onDrag = useClipDrag();
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = (): void => {
      el.toggleAttribute("data-fx", fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth).includes("end"));
      el.toggleAttribute("data-fy", fadeEdges(el.scrollTop, el.clientHeight, el.scrollHeight).includes("end"));
      // The lanes and ruler dissolve under the pinned header column and ruler: their masks start at the scroll offset.
      el.style.setProperty("--sl", `${el.scrollLeft}px`);
      el.style.setProperty("--st", `${el.scrollTop}px`);
    };
    // The lanes show whole tracks only: when they do not all fit, the scroller stops at the last row that does,
    // so no track is ever sliced by the bar or the add bar below. Sized from the box, which does not depend on it.
    const fitRows = (): void => {
      const outer = box.current;
      if (!outer) return;
      const cs = getComputedStyle(el);
      const th = parseFloat(cs.getPropertyValue("--th")) || 64;
      const ruler = parseFloat(cs.getPropertyValue("--ruler-h")) || 38;
      let room = outer.clientHeight;
      for (const sib of outer.children) if (sib !== el) room -= (sib as HTMLElement).offsetHeight;
      const rows = projectStore.get().tracks.length;
      // Everything fits (with the drop space under the last track): let the lanes take the room as before.
      const whole = ruler + rows * th + th <= room ? "" : `${ruler + Math.max(1, Math.floor((room - ruler) / th)) * th}px`;
      if (el.style.maxHeight !== whole) el.style.maxHeight = whole;
      update();
    };
    fitRows();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(fitRows);
    ro.observe(el);
    if (box.current) ro.observe(box.current);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

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
  const endBars = songBars(project);
  const selectedClips = project.tracks.flatMap((t) => t.clips).filter((c) => selectedIds.includes(c.id));
  const inspectorOn = selectedClips.length > 0;
  const editorMulti = editingExists && selectedClips.length > 1 && !samePattern(project, selectedClips) ? selectedClips.length : undefined;
  const multiTracks = !inspectorOn && selectedTrackIds.length > 1;
  const selectedTracks = project.tracks.filter((t) => selectedTrackIds.includes(t.id));

  const resizeHead = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!(e.target as HTMLElement).closest(".arr-resize") || e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = headW;
    let latest = w0;
    const move = (ev: PointerEvent): void => {
      latest = clampHeadWidth(w0 + ev.clientX - x0);
      setHeadW(latest);
    };
    const end = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      lsSet("arrange.headW", latest);
      scroller.current?.classList.remove("resizing");
    };
    scroller.current?.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const slotByTrack = new Map(project.instruments.map((s) => [s.trackId, s.kind]));

  const describe = (trackId: string, kind: string): { icon: TrackIconKind; detail?: string } => {
    const slotKind = slotByTrack.get(trackId);
    const info = slotKind ? INSTRUMENTS.find((i) => i.kind === slotKind) : undefined;
    if (info) return { icon: info.section === "Drums" ? "drums" : "midi", detail: info.name };
    if (kind === "video") return { icon: "video" };
    if (kind === "fx") return { icon: "fx" };
    return { icon: kind === "instrument" ? "midi" : "audio" };
  };

  // Open zoomed so the whole song fills the width; the zoom buttons take over from there.
  const fit = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const headW = parseFloat(getComputedStyle(box).getPropertyValue("--head-w")) || 0;
    const p = projectStore.get();
    setZoom(fitZoom(box.clientWidth - headW - 2, visibleBars(p), p.beatsPerBar));
    box.scrollLeft = 0;
  }, []);
  useLayoutEffect(fit, [fit, project.id]);
  useEffect(() => {
    window.addEventListener("arrange-fit", fit);
    return () => window.removeEventListener("arrange-fit", fit);
  }, [fit]);

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
    <RoomFrame
      title="Arrange"
      head={
        <ProjectHeader
          room="Arrange"
          chips={
            <>
              <InfoChip>{project.key}</InfoChip>
              <InfoChip color="var(--a2)" slot={BPM_CHIP_SLOT}>{Math.round(project.bpm * 10) / 10} BPM</InfoChip>
              {timelineEndBar(project) > 1 && <InfoChip color="var(--a3)" slot={7}>{Math.ceil(timelineEndBar(project) - 1)} bars</InfoChip>}
            </>
          }
        />
      }
      actions={<HeaderTools />}
      footerExtra={<FooterTools />}
    >
      <div className="arr-body">
        <div className="arr-fill frost-sheet">
          <section
            className="arr-panel"
            aria-label="Arrangement"
            onDragOver={onDragOver}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
            }}
            onDrop={onDrop}
          >
            <div className="arr-box" ref={box} style={{ "--head-user": `${headW}px` } as CSSProperties}>
            <div className="arr-scroll" ref={scroller} style={{ "--head-user": `${headW}px`, "--n": project.tracks.length } as CSSProperties} onPointerDown={resizeHead}>
              <div className="arr-canvas" style={{ width: `calc(var(--head-w) + ${bars * ppb}px)` }}>
                <div className="arr-grid" ref={grid}>
                <div className="arr-ruler">
                  <div className="arr-corner">
                    Tracks
                    <span className="arr-resize" role="separator" aria-orientation="vertical" aria-label="Resize track list" />
                  </div>
                  <Ruler bars={bars} ppb={ppb} loop={project.loop} endBars={endBars} beatsPerBar={beatsPerBar} />
                </div>
                <div className="arr-rows">
                {project.tracks.map((track, i) => (
                  <div className="arr-row" key={track.id}>
                    <TrackHeader
                      track={track}
                      {...describe(track.id, track.kind)}
                      selected={selectedTrackIds.includes(track.id) || track.id === selectedTrackId}
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
                      slotState={project.instruments.find((x) => x.trackId === track.id)?.state}
                      endBars={endBars}
                      selectedTrack={track.id === selectedTrackId}
                      selectedIds={selectedIds}
                      snapOn={snap}
                      gridBars={gridInBars(gridBeats, beatsPerBar)}
                      onDrag={onDrag}
                      onOpen={setEditingId}
                      onBackdrop={onBackdrop}
                    />
                  </div>
                ))}
                </div>
                <div className="arr-filler">
                  <div className="arr-head-fill" aria-hidden="true">
                    <span className="arr-resize" role="separator" aria-orientation="vertical" aria-label="Resize track list" />
                  </div>
                  <div
                    className="arr-lane arr-fill-lane"
                    style={laneVars(ppb, beatsPerBar, endBars)}
                    onPointerDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      e.preventDefault();
                      onBackdrop(e);
                    }}
                  >
                    {project.tracks.length === 0 && (
                      <div className="arr-empty">
                        <strong>A blank canvas. The best kind.</strong>
                        <span>Add a track below, or drop audio, video or images anywhere on this panel and they land where you let go.</span>
                      </div>
                    )}
                  </div>
                </div>
                <Playhead ppb={ppb} beatsPerBar={beatsPerBar} scroller={scroller} maxBars={endBars > 0 ? endBars : bars} />
                {band && <div className="arr-marquee" style={{ left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top }} aria-hidden="true" />}
                </div>
              </div>
            </div>
            <HScrollBar scroller={scroller} />
            <div className="arr-addbar">
              <AddTrackBar />
            </div>
            </div>
            {inspectorOn && <Inspector project={project} clips={selectedClips} tracks={project.tracks} onOpenEditor={setEditingId} />}
            {multiTracks && <TrackBar tracks={selectedTracks} />}
            {dropping && (
              <div className="arr-drop" aria-hidden="true">
                Drop to add to your project
              </div>
            )}
          </section>
          {editingExists && editingId && (
            <ClipModal clipId={editingId} label="Clip editor" onClose={() => setEditingId(null)}>
              <Suspense fallback={<div className="ce-empty">Opening the editor…</div>}>
                <ClipEditor clipId={editingId} multi={editorMulti} onClose={() => setEditingId(null)} />
              </Suspense>
            </ClipModal>
          )}
        </div>
      </div>
    </RoomFrame>
  );
}
