import { useCallback, useEffect, useRef, useState } from "react";
import { assetBytesUsed } from "../project/db";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { RoomFrame } from "../ui/RoomFrame";
import { Icon } from "../ui/Icon";
import { handleMediaFiles, MediaTab } from "./library/MediaTab";
import { PluginsTab } from "./library/PluginsTab";
import { openProjectFromInput, ProjectsTab } from "./library/ProjectsTab";
import { openProjectFile } from "./library/actions";
import { PROJECT_FILE } from "./library/media";
import "./library/library.css";

type Tab = "media" | "projects" | "plugins";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "media", label: "Media" },
  { id: "projects", label: "Projects" },
  { id: "plugins", label: "Plugins and MIDI" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function StorageBar() {
  const assetCount = useStore(projectStore, (p) => p.assets.length);
  const [used, setUsed] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    assetBytesUsed().then(
      (n) => {
        setUsed(n);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    void navigator.storage?.estimate?.().then((e) => setQuota(e.quota ?? null), () => setQuota(null));
  }, [assetCount]);
  const pct = used !== null && quota ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <div className="lib-storage">
      <strong>{error ? "Could not read storage use" : used === null ? "Checking storage..." : `${formatBytes(used)} used on this device`}</strong>
      <div className="bar" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
      <span>Files stay here unless you export or publish them</span>
    </div>
  );
}

export default function Library() {
  const [tab, setTab] = useState<Tab>("media");
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const mediaInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const onFiles = useCallback((files: File[]): void => {
    const projects = files.filter((f) => PROJECT_FILE.test(f.name));
    const media = files.filter((f) => !PROJECT_FILE.test(f.name));
    void handleMediaFiles(media);
    if (projects[0]) void openProjectFile(projects[0]);
  }, []);

  return (
    <RoomFrame
      eyebrow="Everything on this device"
      title="Library"
      actions={
        <>
          <div className="lib-tabs" role="tablist" aria-label="Library sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {tab !== "plugins" && (
            <label className="lib-search">
              <Icon name="search" size={20} />
              <input type="search" aria-label={tab === "media" ? "Search media" : "Search projects"} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
        </>
      }
    >
      <div
        className="lib"
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          depth.current += 1;
          setDragging(true);
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          onFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="lib-main" role="tabpanel">
          {tab === "media" && <MediaTab query={query} openPicker={() => mediaInput.current?.click()} />}
          {tab === "projects" && <ProjectsTab query={query} openProjectPicker={() => projectInput.current?.click()} />}
          {tab === "plugins" && <PluginsTab />}
        </div>
        <StorageBar />
        {dragging && <div className="lib-drop">Drop to import</div>}
        <input
          ref={mediaInput}
          type="file"
          multiple
          hidden
          aria-label="Import media files"
          accept="audio/*,video/*,image/*,.mid,.midi"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            onFiles(files);
          }}
        />
        <input
          ref={projectInput}
          type="file"
          hidden
          aria-label="Open a project file"
          accept=".glctc1studio,.glctc1,application/json"
          onChange={(e) => {
            openProjectFromInput(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </RoomFrame>
  );
}
