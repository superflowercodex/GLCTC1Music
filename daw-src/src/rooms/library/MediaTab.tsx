import { useEffect, useMemo, useState } from "react";
import { getPeaks, reducePeaks } from "../../audio/peaks";
import { getAssetBlob } from "../../project/db";
import type { Asset } from "../../project/model";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
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
const KIND_COLOR: Record<Asset["kind"], string> = { audio: "#7cf0c0", midi: "#8e7cff", video: "#ffd36a", image: "#79ebff" };
const BARS = 40;

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
  const color = KIND_COLOR[asset.kind];
  let body: React.ReactNode = null;
  let bg = `color-mix(in srgb, ${color} 12%, transparent)`;
  if (asset.kind === "audio") {
    // Faint stubs hold the place while the waveform decodes.
    const heights = wave && wave !== "unreadable" ? Array.from(wave, (p) => 8 + p * 78) : Array.from({ length: BARS }, () => 8);
    body = heights.map((h, i) => <i key={i} style={{ height: `${h}%`, background: color, opacity: wave && wave !== "unreadable" ? 1 : 0.3 }} />);
  } else if (asset.kind === "midi") {
    const h = hash(asset.id);
    body = (
      <span className="notes">
        {Array.from({ length: 16 }, (_, i) => (
          <b key={i} style={{ left: 10 + i * 14, top: 10 + ((i * 37 + h) % 6) * 12, width: 8 + (i % 3) * 4, background: color }} />
        ))}
      </span>
    );
  } else if (asset.kind === "image") {
    bg = `linear-gradient(135deg, ${color}66, #7cf0c066)`;
    body = <ImageThumb id={asset.id} onSize={onSize} />;
  } else if (asset.kind === "video") {
    bg = "linear-gradient(135deg, #ffd36a55, #ff63d855, #8e7cff55)";
  }
  return (
    <div className="lib-thumb" style={{ background: bg }} aria-hidden="true">
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
    <article className="lib-card" aria-label={asset.name}>
      <Thumb asset={asset} wave={wave} onSize={setSize} />
      <div>
        <div className="lib-name" title={asset.name}>{asset.name}</div>
        <div className="lib-chips">{chips.map((c) => <span key={c}>{c}</span>)}</div>
      </div>
      <div className="lib-actions">
        <button type="button" className="lib-pill" onClick={() => void addAssetToTimeline(asset.id).catch((e: unknown) => toast(`Could not add it: ${e instanceof Error ? e.message : String(e)}`))}>
          Add to timeline
        </button>
        <button
          type="button"
          className="lib-round"
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

export function MediaTab({ query, openPicker }: { query: string; openPicker: () => void }) {
  const assets = useStore(projectStore, (p) => p.assets);
  const [filter, setFilter] = useState<MediaFilter>("all");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...assets]
      .filter((a) => (filter === "all" || a.kind === filter) && (!q || a.name.toLowerCase().includes(q) || (a.detectedKey ?? "").toLowerCase().includes(q)))
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [assets, filter, query]);

  return (
    <div className="lib-pane">
      <div className="lib-bar" role="group" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`chip ${filter === f.id ? "on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <span className="spacer" />
        <span className="eyebrow">Sorted by recently added</span>
      </div>
      <div className="lib-scroll">
        <div className="lib-grid">
          <button type="button" className="lib-tile" onClick={openPicker}>
            <span className="plus" aria-hidden="true">+</span>
            <strong>Import files</strong>
            <span className="hint">Drop audio, MIDI, video, images or a project anywhere on this page</span>
          </button>
          {shown.map((a) => (
            <AssetCard key={a.id} asset={a} />
          ))}
        </div>
        {shown.length === 0 && assets.length > 0 && <div className="lib-empty">Nothing matches. Clear the search or pick All.</div>}
      </div>
    </div>
  );
}

export async function handleMediaFiles(files: readonly File[]): Promise<void> {
  if (files.length > 0) await importLibraryFiles(files);
}
