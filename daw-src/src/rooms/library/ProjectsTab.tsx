import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { listProjects, loadProject, type ProjectSummary } from "../../project/db";
import type { Project } from "../../project/model";
import { detectLegacyProjects, type LegacyAvailability } from "../../project/legacy";
import { describeSaveStatus, persistence, saveStatusStore } from "../../project/persist";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
import { exportProject, importFromOldStudio, importReportStore, openDemoSong, openProjectFile, removeProject } from "./actions";
import { Icon } from "../../ui/Icon";
import { toast } from "./media";
import { Cover, coverLanes, type CoverLane } from "../../gfx/Cover";
import { projectPalette, type Palette } from "../../gfx/palette";
import { InfoChip } from "../../ui/controls";
import { DEMO_BPM, DEMO_KEY, DEMO_NAME, DEMO_TRACKS } from "../../project/demo";

/** The project's cover: its own palette as an aurora, its arrangement as glowing lanes. */
function useProjectSource(id: string): Project | null {
  const [project, setProject] = useState<Project | null>(null);
  const live = useStore(projectStore, (p) => (p.id === id ? p : null));
  useEffect(() => {
    if (live) return;
    let gone = false;
    void loadProject(id).then((p) => !gone && setProject(p ?? null), () => undefined);
    return () => {
      gone = true;
    };
  }, [id, live]);
  return live ?? project;
}

function paletteOf(source: Project | null, id: string): Palette {
  const used = source?.tracks.filter((t) => t.clips.length > 0) ?? [];
  return projectPalette((used.length > 0 ? used : source?.tracks ?? []).map((t) => t.color), id);
}

const DEMO_LANES: CoverLane[] = [
  { color: "#8e7cff", clips: [[2, 30], [38, 28], [70, 26]] },
  { color: "#ff63d8", clips: [[14, 22], [44, 18], [76, 20]] },
  { color: "#79ebff", clips: [[0, 46], [52, 44]] },
  { color: "#f2c14e", clips: [[8, 12], [30, 14], [58, 12], [82, 14]] },
];
const DEMO_PALETTE = projectPalette(["#8e7cff", "#79ebff", "#ff63d8", "#f2c14e"], "demo");

/** The featured way in for a new visitor, laid out like an album page: lit cover, big title, chips, Play. */
function DemoHero({ onOpen }: { onOpen: () => void }) {
  const lit = { "--a1": DEMO_PALETTE.a1, "--a2": DEMO_PALETTE.a2, "--a3": DEMO_PALETTE.a3 } as CSSProperties;
  return (
    <section className="lib-hero" style={lit} aria-label="Try the demo song">
      <div className="cover-glow lib-hero-cover">
        <Cover palette={DEMO_PALETTE} lanes={DEMO_LANES} />
      </div>
      <div className="lib-hero-copy">
        <span className="eyebrow">Featured · Demo song</span>
        <h3>{DEMO_NAME.replace(/\s*\(demo\)$/i, "")}</h3>
        <p>A finished song, ready to pull apart. Press play, then sing over it.</p>
        <div className="ichips">
          <InfoChip>{DEMO_KEY}</InfoChip>
          <InfoChip color="var(--a2)">{DEMO_BPM} BPM</InfoChip>
          <InfoChip color="var(--a3)">{Object.keys(DEMO_TRACKS).length} tracks</InfoChip>
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={onOpen}>
            <Icon name="play" size={18} /> Play the demo
          </button>
        </div>
      </div>
    </section>
  );
}

function when(updatedAt: number, now: number, isOpen: boolean): string {
  const date = new Date(updatedAt);
  const days = Math.floor((now - updatedAt) / 86_400_000);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const label = days < 1 ? `Today, ${time}` : days < 2 ? `Yesterday, ${time}` : date.toLocaleDateString([], { month: "short", day: "numeric" });
  return isOpen ? `Open now · ${label}` : label;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SaveIndicator() {
  const status = useStore(saveStatusStore, (s) => s);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={`lib-status ${status.state}`} role="status">
      <i aria-hidden="true" />
      {status.state === "idle" ? "Autosave is on" : `Autosave: ${describeSaveStatus(status)}`}
      {status.state === "error" && (
        <button type="button" className="btn btn-sm" onClick={() => void persistence().saveNow().catch(() => undefined)}>
          Try again
        </button>
      )}
    </span>
  );
}

function ReportCard() {
  const shown = useStore(importReportStore, (r) => r);
  if (!shown) return null;
  return (
    <section className="lib-note" aria-label="Import report">
      <div className="head">
        <h3>{shown.title}</h3>
        <button type="button" className="btn btn-sm" onClick={() => importReportStore.set(null)}>Dismiss</button>
      </div>
      {shown.report.imported.length > 0 && <ul>{shown.report.imported.map((t) => <li key={t}>{t}</li>)}</ul>}
      {shown.report.skipped.length > 0 ? (
        <>
          <div className="lib-sub">Not carried over</div>
          <ul>{shown.report.skipped.map((t) => <li key={t} className="skip">{t}</li>)}</ul>
        </>
      ) : (
        <div className="lib-sub">Everything came across.</div>
      )}
    </section>
  );
}

function LegacyPanel({ availability, busy, onImport, onClose }: { availability: LegacyAvailability; busy: boolean; onImport: (id: string) => void; onClose: () => void }) {
  return (
    <section className="lib-note" aria-label="Import from the old studio">
      <div className="head">
        <h3>From the old studio</h3>
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      {availability.status === "found" && (
        <>
          <div className="lib-sub">Copies a project into this studio. The old studio and its projects are not changed.</div>
          {availability.projects.map((p) => (
            <div key={p.id} className="lib-legacy-row">
              <span className="grow">{p.name}</span>
              <span className="meta">{Math.round(p.bpm)} BPM · {p.trackCount} tracks</span>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onImport(p.id)}>Import</button>
            </div>
          ))}
        </>
      )}
      {availability.status === "none" && <div className="lib-sub">No saved projects from the old studio were found on this device.</div>}
      {availability.status === "unsupported" && (
        <div className="lib-warn">This browser cannot look for the old studio's projects. In the old studio, use Export Project Package, then choose that file with Open a project file.</div>
      )}
    </section>
  );
}

function ProjectCard({ p, isOpen, now, onChanged }: { p: ProjectSummary; isOpen: boolean; now: number; onChanged: () => void }) {
  const source = useProjectSource(p.id);
  const palette = paletteOf(source, p.id);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  const run = (work: () => Promise<unknown>, failure: string): void => {
    void work().then(onChanged, (e: unknown) => toast(`${failure}: ${errorText(e)}`));
  };
  const commitRename = (): void => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== p.name) run(() => persistence().renameProject(p.id, draft), "Could not rename");
    else setDraft(p.name);
  };

  return (
    <article className={`lib-card project ${isOpen ? "current" : ""}`} aria-label={p.name} style={{ "--k": palette.a1, "--a1": palette.a1, "--a2": palette.a2, "--a3": palette.a3 } as CSSProperties}>
      <div className="lib-art-wrap cover-glow">
        <Cover palette={palette} lanes={coverLanes(source?.tracks ?? [], 5)} />
        {isOpen && <span className="lib-art-live">Open now</span>}
      </div>
      <div className="lib-card-text">
        {renaming ? (
          <input
            ref={input}
            className="lib-rename"
            aria-label="Project name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(p.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button type="button" className="lib-name-btn" title="Click to rename" onClick={() => { setDraft(p.name); setRenaming(true); }}>
            {p.name}
          </button>
        )}
        <div className="lib-when">{when(p.updatedAt, now, isOpen)}</div>
        <div className="ichips">
          {source?.key && <InfoChip>{source.key}</InfoChip>}
          <InfoChip color="var(--a2)">{Math.round(p.bpm)} BPM</InfoChip>
          <InfoChip color="var(--a3)">{p.trackCount} track{p.trackCount === 1 ? "" : "s"}</InfoChip>
        </div>
      </div>
      <div className="lib-row-actions">
        <button type="button" className="btn btn-sm btn-primary grow" disabled={isOpen} onClick={() => run(() => persistence().openProject(p.id).then(() => toast(`"${p.name}" is open. Pick up where you left off.`)), "Could not open")}>
          {isOpen ? "Open now" : "Open"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void exportProject(p.id)}>Export package</button>
        <button type="button" className="icon-btn" aria-label={`Duplicate ${p.name}`} title="Duplicate" onClick={() => run(() => persistence().duplicateProject(p.id).then((c) => toast(`Made "${c.name}", a fresh copy to mess with.`)), "Could not duplicate")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" /></svg>
        </button>
        <button type="button" className="icon-btn lib-del" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => run(() => removeProject(p.id, p.name), "Could not delete")}>
          <Icon name="trash" size={18} />
        </button>
      </div>
    </article>
  );
}

export function ProjectsTab({ query, openProjectPicker }: { query: string; openProjectPicker: () => void }) {
  const openId = useStore(projectStore, (p) => p.id);
  const openName = useStore(projectStore, (p) => p.name);
  const saveState = useStore(saveStatusStore, (s) => s.state);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<LegacyAvailability | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback((): void => {
    listProjects().then(
      (list) => {
        setProjects(list);
        setLoadError(null);
      },
      (e: unknown) => setLoadError(errorText(e)),
    );
  }, []);
  useEffect(refresh, [refresh, openId, openName, saveState]);

  const now = Date.now();
  const q = query.trim().toLowerCase();
  const shown = projects.filter((p) => !q || p.name.toLowerCase().includes(q));

  const checkLegacy = (): void => {
    detectLegacyProjects().then(setLegacy, (e: unknown) => toast(`Could not look for the old studio: ${errorText(e)}`));
  };

  return (
    <div className="lib-pane">
      <div className="lib-bar">
        <button type="button" className="btn btn-primary" onClick={() => void persistence().newProject().then(() => { toast("Fresh project, fresh start. Go make some noise."); refresh(); }, (e: unknown) => toast(errorText(e)))}>
          New project
        </button>
        <button type="button" className="btn" onClick={openProjectPicker}>Open a project file</button>
        <button type="button" className="btn btn-outline" onClick={legacy ? () => setLegacy(null) : checkLegacy}>Import from the old studio</button>
        <span className="spacer" />
        <SaveIndicator />
      </div>
      <div className="lib-scroll">
        <DemoHero onOpen={() => void openDemoSong().then(refresh)} />
        <ReportCard />
        {legacy && (
          <LegacyPanel
            availability={legacy}
            busy={busy}
            onClose={() => setLegacy(null)}
            onImport={(id) => {
              setBusy(true);
              void importFromOldStudio(id).finally(() => {
                setBusy(false);
                refresh();
              });
            }}
          />
        )}
        {loadError && <div className="lib-error" role="alert">Could not list your projects: {loadError}</div>}
        <div className="lib-grid wide">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} isOpen={p.id === openId} now={now} onChanged={refresh} />
          ))}
        </div>
        {projects.length === 0 && !loadError && <div className="lib-empty"><span className="lib-empty-glyph" aria-hidden="true" />Quiet in here. Start a project, open a project file, or take the demo for a spin.</div>}
        {shown.length === 0 && projects.length > 0 && <div className="lib-empty">Nothing by that name. Try fewer letters?</div>}
        <section className="lib-publish" aria-label="Publish to GLCTC1">
          <div>
            <h3>Publish to GLCTC1</h3>
            <p>Send a finished track to radio and your artist page. Cover art, title and the release date are asked for in one sheet.</p>
          </div>
          <span className="tag">Coming soon</span>
          <button type="button" className="btn btn-sm" disabled title="Coming soon">Publish a track</button>
        </section>
      </div>
    </div>
  );
}

export function openProjectFromInput(files: FileList | null): void {
  const file = files?.[0];
  if (file) void openProjectFile(file);
}
