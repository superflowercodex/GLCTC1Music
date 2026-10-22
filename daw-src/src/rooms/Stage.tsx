import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEngine, peekEngine } from "../audio/engine";
import { stepDuration } from "../audio/clock";
import { barBeat, togglePlay } from "../audio/transport";
import { getAssetBlob } from "../project/db";
import type { Asset, Clip } from "../project/model";
import { lsGet, lsSet } from "../storage";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { Button, Seg, Slider, Switch } from "../ui/controls";
import { prefersReducedMotion, useRaf } from "../ui/hooks";
import { Icon } from "../ui/Icon";
import { RoomFrame } from "../ui/RoomFrame";
import { CaptureError, startCapture, type StageRecording } from "./stage/capture";
import "./stage/stage.css";
import {
  addStageClip,
  barSeconds,
  formatClock,
  frameAspect,
  MAX_SHOW_BARS,
  MAX_SPEED,
  MIN_SPEED,
  stageClips,
  stageOptions,
  timelineEndBar,
  updateStageClip,
} from "./stage/stageModel";
import type { StageScene } from "./stage/stageScene";

function toast(text: string): void {
  uiStore.set((s) => ({ ...s, toast: { id: Date.now(), text } }));
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const thumbCache = new Map<string, string>();

async function makeThumb(assetId: string, kind: "video" | "image"): Promise<string | undefined> {
  const cached = thumbCache.get(assetId);
  if (cached) return cached;
  const blob = await getAssetBlob(assetId);
  if (!blob) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const g = canvas.getContext("2d");
  if (!g) return undefined;
  if (kind === "image") {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.max(320 / bitmap.width, 180 / bitmap.height);
    g.drawImage(bitmap, (320 - bitmap.width * scale) / 2, (180 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    bitmap.close();
  } else {
    const url = URL.createObjectURL(blob);
    try {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("unsupported video"));
      });
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });
      const scale = Math.max(320 / video.videoWidth, 180 / video.videoHeight);
      g.drawImage(video, (320 - video.videoWidth * scale) / 2, (180 - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const data = canvas.toDataURL("image/jpeg", 0.7);
  thumbCache.set(assetId, data);
  return data;
}

function useThumb(assetId: string | undefined, kind: "video" | "image"): string | undefined {
  const [src, setSrc] = useState<string | undefined>(assetId ? thumbCache.get(assetId) : undefined);
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    // A thumbnail is decoration: when decoding fails the card keeps its gradient and the preview reports the real error.
    makeThumb(assetId, kind).then((s) => alive && setSrc(s), () => undefined);
    return () => {
      alive = false;
    };
  }, [assetId, kind]);
  return src;
}

function ClipCard({ clip, selected, onPick }: { clip: Clip; selected: boolean; onPick: () => void }) {
  const thumb = useThumb(clip.assetId, clip.kind === "image" ? "image" : "video");
  return (
    <button type="button" className={`stage-clip ${selected ? "sel" : ""}`} aria-pressed={selected} onClick={onPick}>
      <span className="stage-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />
      <span className="stage-clip-text">
        <b>{clip.name}</b>
        <small>
          {clip.kind === "image" ? "Image" : "Video"} · bar {clip.startBar}–{clip.startBar + clip.lengthBars}
        </small>
      </span>
    </button>
  );
}

export default function Stage() {
  const name = useStore(projectStore, (p) => p.name);
  const aspect = useStore(projectStore, (p) => p.stageAspect);
  const tracks = useStore(projectStore, (p) => p.tracks);
  const assets = useStore(projectStore, (p) => p.assets);
  const selectedId = useStore(uiStore, (s) => s.selectedClipId);

  const clips = useMemo(() => stageClips(projectStore.get()), [tracks]);
  const selected = clips.find((c) => c.id === selectedId) ?? clips[0];

  const viewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StageScene | null>(null);
  const recordingRef = useRef<StageRecording | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [visuals, setVisuals] = useState(() => lsGet("stage.visuals", true));
  const [fullscreen, setFullscreen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);

  const timeRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false);
  const lastError = useRef({ text: "", at: 0 });

  const reportError = useCallback((text: string) => {
    const now = Date.now();
    if (lastError.current.text === text && now - lastError.current.at < 5000) return;
    lastError.current = { text, at: now };
    toast(text);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    (async () => {
      const [THREE, { StageScene: Scene }] = await Promise.all([import("three"), import("./stage/stageScene")]);
      if (cancelled) return;
      try {
        const scene = new Scene(
          THREE,
          canvas,
          {
            project: () => projectStore.get(),
            timeSec: () => {
              const p = projectStore.get();
              const engine = peekEngine();
              return engine ? engine.clock.position() * stepDuration(p.bpm) : 0;
            },
            playing: () => peekEngine()?.clock.playing ?? false,
            spectrum: (out) => {
              const engine = peekEngine();
              if (!engine) return false;
              engine.analyser.getByteFrequencyData(out);
              return true;
            },
            loadBlob: getAssetBlob,
            onError: reportError,
          },
          { reducedMotion: prefersReducedMotion(), small: window.innerWidth < 700 },
        );
        sceneRef.current = scene;
        scene.setVisuals(lsGet("stage.visuals", true));
        scene.start();
        setSceneReady(true);
      } catch (e) {
        setSceneError(`The 3D stage could not start: ${reason(e)}`);
      }
    })().catch((e: unknown) => setSceneError(`The 3D stage could not load: ${reason(e)}`));
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setSceneReady(false);
      const rec = recordingRef.current;
      recordingRef.current = null;
      void rec?.stop().catch(() => undefined);
    };
  }, [reportError]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setClips(clips);
  }, [clips, sceneReady]);

  useEffect(() => {
    sceneRef.current?.setVisuals(visuals);
    lsSet("stage.visuals", visuals);
  }, [visuals, sceneReady]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === viewRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const endBar = Math.max(timelineEndBar(projectStore.get()), 9);

  useRaf(() => {
    const p = projectStore.get();
    const engine = peekEngine();
    const step = engine ? engine.clock.position() : 0;
    const sec = step * stepDuration(p.bpm);
    const total = (Math.max(timelineEndBar(p), 9) - 1) * barSeconds(p.bpm, p.beatsPerBar);
    if (timeRef.current) timeRef.current.textContent = formatClock(sec);
    if (endRef.current) endRef.current.textContent = formatClock(total);
    const scrub = scrubRef.current;
    if (scrub && !scrubbing.current) {
      scrub.max = String(total);
      scrub.value = String(Math.min(sec, total));
      scrub.style.setProperty("--pct", `${total > 0 ? (Math.min(sec, total) / total) * 100 : 0}%`);
    }
    const isPlaying = engine?.clock.playing ?? false;
    setPlaying((prev) => (prev === isPlaying ? prev : isPlaying));
  });

  function seekTo(sec: number): void {
    const p = projectStore.get();
    getEngine().clock.seek(sec / stepDuration(p.bpm));
    sceneRef.current?.invalidate();
    scrubRef.current?.style.setProperty("--pct", `${(sec / Math.max(0.001, Number(scrubRef.current.max))) * 100}%`);
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (viewRef.current?.requestFullscreen) await viewRef.current.requestFullscreen();
      else toast("This browser does not allow fullscreen for the stage.");
    } catch (e) {
      toast(`Fullscreen was refused: ${reason(e)}`);
    }
  }

  async function toggleCapture(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (recordingRef.current) {
        const rec = recordingRef.current;
        recordingRef.current = null;
        setRecording(false);
        const blob = await rec.stop();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${projectStore.get().name || "stage"}.${rec.extension}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        toast("Stage video saved to your downloads.");
        return;
      }
      await getEngine().resume();
      recordingRef.current = startCapture(canvas, peekEngine());
      setRecording(true);
      toast("Recording the stage. Press play, then stop the recording to save it.");
    } catch (e) {
      recordingRef.current = null;
      setRecording(false);
      toast(e instanceof CaptureError ? e.message : `Recording failed: ${reason(e)}`);
    }
  }

  function addAsset(asset: Asset): void {
    try {
      const p = projectStore.get();
      const bar = barBeat(peekEngine()?.clock.position() ?? 0, p.beatsPerBar).bar;
      const next = addStageClip(p, asset, bar);
      projectStore.set(next);
      const added = stageClips(next).find((c) => c.assetId === asset.id && c.startBar === bar);
      if (added) uiStore.set((s) => ({ ...s, selectedClipId: added.id }));
      setPicker(false);
    } catch (e) {
      toast(reason(e));
    }
  }

  function edit(change: (c: Clip) => Clip): void {
    if (selected) projectStore.set((p) => updateStageClip(p, selected.id, change));
  }

  function removeSelected(): void {
    if (!selected) return;
    projectStore.set((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== selected.id) })) }));
    uiStore.set((s) => ({ ...s, selectedClipId: null }));
  }

  const options = selected ? stageOptions(selected) : undefined;
  const mediaAssets = assets.filter((a) => a.kind === "video" || a.kind === "image");
  const wide = aspect === "wide";

  return (
    <RoomFrame
      eyebrow={`${name} · visuals follow the playhead`}
      title="Stage"
      hideTransport
      actions={
        <div className="stage-tools">
          <Seg
            label="Stage shape"
            value={aspect}
            onChange={(v) => projectStore.set((p) => ({ ...p, stageAspect: v }))}
            options={[
              { value: "wide", label: "Widescreen" },
              { value: "phone", label: "Phone" },
            ]}
          />
          <div style={{ width: 170 }}>
            <Switch label="Visuals" checked={visuals} onChange={setVisuals} />
          </div>
          <Button onClick={() => void toggleCapture()}>
            <span className={recording ? "stage-rec" : undefined}>{recording ? "Stop and save" : "Capture video"}</span>
          </Button>
          <Button onClick={() => void toggleFullscreen()}>
            <Icon name="fullscreen" size={20} />
            Fullscreen
          </Button>
        </div>
      }
    >
      <div className="stage-body">
        <section className="stage-main" aria-label="Preview">
          <div className="stage-view" ref={viewRef}>
            <div className="stage-frame" style={{ "--ar": frameAspect(aspect) } as React.CSSProperties}>
              <canvas ref={canvasRef} aria-label={`Stage preview, ${wide ? "widescreen" : "phone"} shape`} role="img" />
              {sceneError ? (
                <div className="stage-title">
                  <div className="stage-error" role="alert">
                    {sceneError}
                  </div>
                </div>
              ) : (
                clips.length === 0 && (
                  <div className="stage-title">
                    <strong>{name.toUpperCase()}</strong>
                    <span>ADD A VIDEO OR PICTURE BELOW</span>
                  </div>
                )
              )}
            </div>
            {fullscreen && (
              <button type="button" className="btn stage-fs-exit" onClick={() => void toggleFullscreen()}>
                Exit fullscreen
              </button>
            )}
          </div>

          <div className="stage-bar">
            <button type="button" className="play-btn" aria-label={playing ? "Pause" : "Play preview"} onClick={() => void togglePlay()}>
              <Icon name={playing ? "pause" : "play"} size={22} />
            </button>
            <span className="mono" ref={timeRef}>
              00:00
            </span>
            <input
              ref={scrubRef}
              className="stage-scrub"
              type="range"
              min={0}
              max={(endBar - 1) * 2}
              step={0.01}
              defaultValue={0}
              aria-label="Position"
              onPointerDown={() => (scrubbing.current = true)}
              onPointerUp={() => (scrubbing.current = false)}
              onBlur={() => (scrubbing.current = false)}
              onChange={(e) => seekTo(Number(e.target.value))}
            />
            <span className="mono" ref={endRef}>
              00:00
            </span>
          </div>

          <div className="stage-strip" aria-label="Clips">
            {clips.map((c) => (
              <ClipCard key={c.id} clip={c} selected={c.id === selected?.id} onPick={() => uiStore.set((s) => ({ ...s, selectedClipId: c.id }))} />
            ))}
            <button type="button" className="stage-add" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>
              <span style={{ fontSize: 26, lineHeight: 1 }}>+</span>Add
            </button>
            {picker && (
              <div className="stage-picker" role="menu" aria-label="Add a video or picture">
                {mediaAssets.length === 0 ? (
                  <p>
                    No videos or pictures yet. Import some in <a href="#/library" style={{ color: "var(--cyan)" }}>Library</a>, then add them here.
                  </p>
                ) : (
                  mediaAssets.map((a) => (
                    <button key={a.id} type="button" role="menuitem" onClick={() => addAsset(a)}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      <span className="mono" style={{ color: "var(--muted)" }}>
                        {a.kind}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="stage-side" aria-label="Clip">
          {selected && options ? (
            <>
              <div>
                <div className="label">Selected</div>
                <h2>{selected.name}</h2>
                <div className="mono" style={{ fontSize: 15, color: "var(--muted)", marginTop: 4 }}>
                  {selected.kind === "image" ? "Image" : "Video"} · bar {selected.startBar}–{selected.startBar + selected.lengthBars}
                </div>
              </div>
              <div>
                <div className="label">Fit</div>
                <Seg
                  label="Fit"
                  value={options.fit}
                  onChange={(fit) => edit((c) => ({ ...c, stage: { ...stageOptions(c), fit } }))}
                  options={[
                    { value: "fill", label: "Fill" },
                    { value: "fit", label: "Fit" },
                    { value: "stretch", label: "Stretch" },
                  ]}
                />
              </div>
              <Slider label="Opacity" value={options.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => edit((c) => ({ ...c, stage: { ...stageOptions(c), opacity } }))} />
              {selected.kind === "video" && (
                <Slider label="Speed" value={options.speed} min={MIN_SPEED} max={MAX_SPEED} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => edit((c) => ({ ...c, stage: { ...stageOptions(c), speed } }))} />
              )}
              <Slider label="Show for" value={selected.lengthBars} min={1} max={MAX_SHOW_BARS} step={1} format={(v) => `${v} bar${v === 1 ? "" : "s"}`} onChange={(lengthBars) => edit((c) => ({ ...c, lengthBars }))} />
              <Button variant="danger" onClick={removeSelected}>
                Remove from stage
              </Button>
              <p className="hint">{selected.kind === "image" ? "Pictures stay on screen for as long as their clip lasts on the timeline." : "Videos play in time with the transport and loop if the clip is longer than the file."}</p>
            </>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              Pick a clip below to change how it fills the stage, how see-through it is and how long it shows. The glowing galaxy behind it listens to the music.
            </p>
          )}
        </aside>
      </div>
    </RoomFrame>
  );
}
