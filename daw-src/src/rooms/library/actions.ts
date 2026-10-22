import { flushInstrumentStates } from "../../project/instruments";
import { describeLegacyExtras, readAndConvertLegacyProject } from "../../project/legacy";
import { exportProjectPackage, importPackageFile, type Ask, type ImportReport } from "../../project/package";
import { buildDemoProject } from "../../project/demo";
import { getAssetBlob, loadProject } from "../../project/db";
import { migrateProject } from "../../project/migrate";
import { newId } from "../../project/model";
import { persistence } from "../../project/persist";
import { projectStore } from "../../store/project";
import { createStore } from "../../store/store";
import { choiceSheet, confirmSheet } from "../../sheets/confirm";
import { toast } from "./media";

export interface ShownReport {
  title: string;
  report: ImportReport;
}

/** What the last import brought in and left behind. The Projects tab shows it until dismissed. */
export const importReportStore = createStore<ShownReport | null>(null);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportProject(id: string): Promise<void> {
  try {
    const open = projectStore.get();
    let project = open;
    if (id === open.id) {
      flushInstrumentStates();
    } else {
      const stored = await loadProject(id);
      if (!stored) throw new Error("That project is no longer saved on this device.");
      project = migrateProject(stored);
    }
    const exported = await exportProjectPackage(project, getAssetBlob);
    downloadBlob(exported.blob, exported.fileName);
    toast(
      exported.missing.length
        ? `Exported, but ${exported.missing.length} file${exported.missing.length === 1 ? " was" : "s were"} missing from this device: ${exported.missing.join(", ")}.`
        : `Exported ${exported.fileName}. Keep it safe as a backup.`,
    );
  } catch (error) {
    toast(`Could not export: ${messageOf(error)}`);
  }
}

/** Opens a .glctc1studio or old .glctc1 file as a new saved project (or asks what to do about a clash) and opens it. */
export async function openProjectFile(file: File): Promise<void> {
  // The package importer asks through its own Ask contract; the first choice is the primary button, dismissing means "cancel".
  const ask: Ask = async (q) => {
    const [first, ...rest] = q.choices;
    const cancel = rest.find((c) => c.id === "cancel");
    const answer = await choiceSheet({
      title: q.title,
      message: q.message,
      choices: [first, ...rest.filter((c) => c !== cancel)].map((c) => ({ id: c.id, label: c.label, tone: c.tone === "danger" ? "danger" : c.tone === "neutral" ? "secondary" : "primary" })),
      cancelLabel: cancel?.label,
    });
    return answer ?? "cancel";
  };
  try {
    const p = persistence();
    const result = await importPackageFile(file, { ask, hasProject: (id) => p.hasProject(id), commit: (project, media, mode) => p.commitImport(project, media, mode) });
    if (result.status === "cancelled" || !result.projectId) return;
    importReportStore.set({ title: `Imported "${result.projectName ?? file.name}"`, report: result.report });
    await p.openProject(result.projectId);
    toast(result.status === "replaced" ? "Replaced the saved project and opened it." : `Opened "${result.projectName ?? file.name}".`);
  } catch (error) {
    toast(`Could not open ${file.name}: ${messageOf(error)}`);
  }
}

export async function importFromOldStudio(id: string): Promise<void> {
  try {
    const p = persistence();
    const parsed = await readAndConvertLegacyProject(id);
    let storage: Storage | null = null;
    try {
      storage = localStorage;
    } catch {
      // Blocked storage: nothing to report from it.
    }
    const extras = await describeLegacyExtras(storage);
    const report: ImportReport = { imported: parsed.report.imported, skipped: [...parsed.report.skipped, ...extras] };
    await p.commitImport(parsed.project, parsed.media, "add");
    importReportStore.set({ title: `Imported "${parsed.project.name}" from the old studio`, report });
    await p.openProject(parsed.project.id);
    toast(`Copied "${parsed.project.name}" from the old studio. The original is untouched.`);
  } catch (error) {
    toast(`Could not import from the old studio: ${messageOf(error)}`);
  }
}

export async function removeProject(id: string, name: string): Promise<void> {
  const isOpen = id === projectStore.get().id;
  const confirmed = await confirmSheet({
    title: `Delete "${name}"?`,
    message: isOpen ? "This is the open project. Its media is deleted too and a blank project opens. This cannot be undone." : "Its media is deleted too. This cannot be undone.",
    confirmLabel: "Delete project",
    cancelLabel: "Keep it",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await persistence().deleteProject(id);
    toast(`Deleted "${name}".`);
  } catch (error) {
    toast(`Could not delete: ${messageOf(error)}`);
  }
}

/** Saves a fresh copy of the demo song as its own project and opens it; the open project is saved first, never replaced. */
export async function openDemoSong(): Promise<void> {
  try {
    const p = persistence();
    const demo = buildDemoProject({ id: newId("proj"), now: Date.now() });
    await p.commitImport(demo, new Map(), "add");
    await p.openProject(demo.id);
    toast(`"${demo.name}" is all yours. Press Play, or sing over it on the Vocal track.`);
  } catch (error) {
    toast(`Could not open the demo song: ${messageOf(error)}`);
  }
}
