import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects, type ProjectSummary } from "../../project/db";
import { detectLegacyProjects, type LegacyAvailability } from "../../project/legacy";
import { describeSaveStatus, persistence, saveStatusStore } from "../../project/persist";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
import { exportProject, importFromOldStudio, importReportStore, openProjectFile, removeProject } from "./actions";
import { toast } from "./media";

const ART = [
  "linear-gradient(135deg,#8e7cff66,#ff63d855,#79ebff55)",
  "linear-gradient(135deg,#79ebff55,#0b1030)",
  "linear-gradient(135deg,#7cf0c055,#8e7cff44)",
  "linear-gradient(135deg,#ffd36a55,#ff63d844)",
];

function art(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ART[h % ART.length] ?? "";
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
        <button type="button" className="lib-pill small" onClick={() => void persistence().saveNow().catch(() => undefined)}>
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
        <button type="button" className="lib-pill small" onClick={() => importReportStore.set(null)}>Dismiss</button>
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
        <button type="button" className="lib-pill small" onClick={onClose}>Close</button>
      </div>
      {availability.status === "found" && (
        <>
          <div className="lib-sub">Copies a project into this studio. The old studio and its projects are not changed.</div>
          {availability.projects.map((p) => (
            <div key={p.id} className="lib-legacy-row">
              <span className="grow">{p.name}</span>
              <span className="meta">{Math.round(p.bpm)} BPM · {p.trackCount} tracks</span>
              <button type="button" className="lib-pill small" disabled={busy} onClick={() => onImport(p.id)}>Import</button>
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
    <article className={`lib-card ${isOpen ? "current" : ""}`} aria-label={p.name} style={{ padding: 16, gap: 12 }}>
      <div className="lib-project-art" style={{ background: art(p.id) }}>
        <span>{Math.round(p.bpm)} BPM · {p.trackCount} track{p.trackCount === 1 ? "" : "s"}</span>
      </div>
      <div>
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
      </div>
      <div className="lib-row-actions">
        <button type="button" className="lib-pill" disabled={isOpen} onClick={() => run(() => persistence().openProject(p.id).then(() => toast(`Opened "${p.name}".`)), "Could not open")}>
          {isOpen ? "Open now" : "Open"}
        </button>
        <button type="button" className="lib-pill" onClick={() => void exportProject(p.id)}>Export package</button>
      </div>
      <div className="lib-row-actions">
        <button type="button" className="lib-pill small" onClick={() => run(() => persistence().duplicateProject(p.id).then((c) => toast(`Made "${c.name}".`)), "Could not duplicate")}>Duplicate</button>
        <button type="button" className="lib-pill small danger" onClick={() => run(() => removeProject(p.id, p.name), "Could not delete")}>Delete</button>
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
        <button type="button" className="lib-pill primary" onClick={() => void persistence().newProject().then(() => { toast("New project ready."); refresh(); }, (e: unknown) => toast(errorText(e)))}>
          New project
        </button>
        <button type="button" className="lib-pill" onClick={openProjectPicker}>Open a project file</button>
        <button type="button" className="lib-pill" onClick={legacy ? () => setLegacy(null) : checkLegacy}>Import from the old studio</button>
        <span className="spacer" />
        <SaveIndicator />
      </div>
      <div className="lib-scroll">
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
        {shown.length === 0 && projects.length > 0 && <div className="lib-empty">No project matches that search.</div>}
        <section className="lib-publish" aria-label="Publish to GLCTC1">
          <div>
            <h3>Publish to GLCTC1</h3>
            <p>Send a finished track to radio and your artist page. Cover art, title and the release date are asked for in one sheet.</p>
          </div>
          <span className="lib-soon">Coming soon</span>
          <button type="button" className="lib-pill" disabled title="Coming soon">Publish a track</button>
        </section>
      </div>
    </div>
  );
}

export function openProjectFromInput(files: FileList | null): void {
  const file = files?.[0];
  if (file) void openProjectFile(file);
}
