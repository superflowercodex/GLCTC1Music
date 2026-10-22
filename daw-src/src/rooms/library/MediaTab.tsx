import { useEffect, useMemo, useState } from "react";
import { getPeaks, reducePeaks } from "../../audio/peaks";
import { getAssetBlob } from "../../project/db";
import type { Asset } from "../../project/model";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
import { Caption } from "../../ui/Caption";
import { Icon } from "../../ui/Icon";
import { addAssetToTimeline, deleteAsset, importLibraryFiles, toast, type MediaFilter } from "./media";

const FILTERS: ReadonlyArray<{ id: MediaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "audio", label: "Audio" },
  { id: "midi", label: "MIDI" },
  { id: "video", label: "Video" },
  { id: "image", label: "Images" },
];

const KIND_LABEL: Record<Asset["kind"], string> = { audio: "Audio", midi: "MIDI", video: "Video", image: "Image" };
export const KIND_COLOR: Record<Asset["kind"], string> = { audio: "#5fe3a1", midi: "#8e7cff", video: "#f2c14e", image: "#79ebff" };
const BARS = 48;

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function chipsFor(a: Asset, size: string | null): string[] {
  const chips: string[] = [];
  if (a.kind === "image") {
    if (size) chips.push(size);
  } else {
    if (a.detectedBpm) chips.push(`${Math.round(a.detectedBpm)} BPM`);
    if (a.detectedKey) chips.push(a.detectedKey);
    if (a.durationSec !== undefined) chips.push(formatDuration(a.durationSec));
  }
  return chips;
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export function UploadGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function ImageThumb({ id, onSize }: { id: string; onSize: (size: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    let made: string | null = null;
    void getAssetBlob(id).then((blob) => {
      if (!blob || gone) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  return url ? <img src={url} alt="" onLoad={(e) => onSize(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} /> : null;
}

/** Heights 0 to 1 for a waveform thumbnail, from the shared peak cache; null while it decodes, "unreadable" if it cannot. */
function useWaveform(asset: Asset): Float32Array | null | "unreadable" {
  const [state, setState] = useState<Float32Array | null | "unreadable">(null);
  useEffect(() => {
    if (asset.kind !== "audio") return;
    let gone = false;
    getPeaks(asset.id).then(
      (peaks) => {
        if (gone) return;
        if (!peaks) return setState("unreadable");
        const bins = reducePeaks(peaks, 0, peaks.data.length / peaks.perSec, BARS);
        const max = Math.max(...bins, 1e-6);
        setState(bins.map((v) => v / max));
      },
      () => !gone && setState("unreadable"),
    );
    return () => {
      gone = true;
    };
  }, [asset.id, asset.kind]);
  return state;
}

function Thumb({ asset, wave, onSize }: { asset: Asset; wave: Float32Array | null | "unreadable"; onSize: (size: string) => void }) {
  let body: React.ReactNode = null;
  if (asset.kind === "audio") {
    // Faint stubs hold the place while the waveform decodes.
    const ready = wave && wave !== "unreadable";
    const heights = ready ? Array.from(wave, (p) => 8 + p * 84) : Array.from({ length: BARS }, () => 8);
    body = (
      <span className={`wave ${ready ? "" : "wait"}`}>
        {heights.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
      </span>
    );
  } else if (asset.kind === "midi") {
    const h = hash(asset.id);
    body = (
      <span className="notes">
        {Array.from({ length: 18 }, (_, i) => (
          <b key={i} style={{ left: `${4 + i * 5.2}%`, top: `${6 + ((i * 37 + h) % 7) * 12.5}%`, width: `${3 + (i % 3) * 2.2}%` }} />
        ))}
      </span>
    );
  } else if (asset.kind === "image") {
    body = <ImageThumb id={asset.id} onSize={onSize} />;
  } else {
    body = (
      <span className="play" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
      </span>
    );
  }
  return (
    <div className={`lib-thumb ${asset.kind}`} aria-hidden="true">
      {body}
      <span className="lib-kind">{KIND_LABEL[asset.kind]}</span>
    </div>
  );
}

function AssetCard({ asset }: { asset: Asset }) {
  const wave = useWaveform(asset);
  const [size, setSize] = useState<string | null>(null);
  const chips = chipsFor(asset, size);
  if (wave === "unreadable") chips.push("can't read file");
  return (
    <article className="lib-card" aria-label={asset.name} style={{ "--k": KIND_COLOR[asset.kind] } as React.CSSProperties}>
      <Thumb asset={asset} wave={wave} onSize={setSize} />
      <div className="lib-info">
        <div className="lib-name" title={asset.name}>{asset.name}</div>
        <div className="lib-chips">{chips.map((c) => <span key={c}>{c}</span>)}</div>
      </div>
      <div className="lib-actions">
        <button type="button" className="btn btn-sm" onClick={() => void addAssetToTimeline(asset.id).catch((e: unknown) => toast(`Could not add it: ${e instanceof Error ? e.message : String(e)}`))}>
          Add to timeline
        </button>
        <button
          type="button"
          className="icon-btn lib-del"
          aria-label={`Delete ${asset.name}`}
          title={`Delete ${asset.name}`}
          onClick={() => void deleteAsset(asset.id).catch((e: unknown) => toast(`Could not delete it: ${e instanceof Error ? e.message : String(e)}`))}
        >
          <Icon name="trash" size={18} />
        </button>
      </div>
    </article>
  );
}

function DropZone({ openPicker, big }: { openPicker: () => void; big?: boolean }) {
  return (
    <button type="button" className={`lib-drop-zone ${big ? "big" : ""}`} onClick={openPicker}>
      <span className="glyph"><UploadGlyph size={big ? 34 : 26} /></span>
      <strong>Import files</strong>
      <span className="hint">Drop audio, MIDI, video, images or a project anywhere on this page</span>
      {big && (
        <span className="formats" aria-hidden="true">
          {["WAV", "MP3", "MID", "MP4", "PNG"].map((f) => <em key={f}>{f}</em>)}
        </span>
      )}
    </button>
  );
}

export function MediaTab({ query, openPicker }: { query: string; openPicker: () => void }) {
  const assets = useStore(projectStore, (p) => p.assets);
  const [filter, setFilter] = useState<MediaFilter>("all");

  const counts = useMemo(() => {
    const c: Record<MediaFilter, number> = { all: assets.length, audio: 0, midi: 0, video: 0, image: 0 };
    for (const a of assets) c[a.kind] += 1;
    return c;
  }, [assets]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...assets]
      .filter((a) => (filter === "all" || a.kind === filter) && (!q || a.name.toLowerCase().includes(q) || (a.detectedKey ?? "").toLowerCase().includes(q)))
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [assets, filter, query]);

  if (assets.length === 0) {
    return (
      <div className="lib-pane empty">
        <DropZone openPicker={openPicker} big />
      </div>
    );
  }

  return (
    <div className="lib-pane">
      <div className="lib-bar" role="group" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`chip ${filter === f.id ? "on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            <span className="count">{counts[f.id]}</span>
          </button>
        ))}
        <span className="spacer" />
        <Caption aside={`${shown.length} of ${assets.length}`}>Recently added</Caption>
      </div>
      <div className="lib-scroll">
        <div className="lib-grid">
          <DropZone openPicker={openPicker} />
          {shown.map((a) => (
            <AssetCard key={a.id} asset={a} />
          ))}
        </div>
        {shown.length === 0 && <div className="lib-empty">Nothing matches. Clear the search or pick All.</div>}
      </div>
    </div>
  );
}

export async function handleMediaFiles(files: readonly File[]): Promise<void> {
  if (files.length > 0) await importLibraryFiles(files);
}
