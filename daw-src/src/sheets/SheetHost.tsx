import { lazy, Suspense, useEffect, useState } from "react";
import { uiStore } from "../store/project";
import { useStore } from "../store/store";
import { ConfirmSheet } from "./ConfirmSheet";
import { PaletteSheet } from "./PaletteSheet";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { ToastRegion } from "./Toast";
import "../ui/frost.css";
import "./sheets.css";

// Record, export and the performance recorder pull in the recorder and the offline renderer, so they load on first use.
const loadRecord = () => import("./RecordSheet");
const loadExport = () => import("./ExportSheet");
const loadPerformance = () => import("./PerformanceSheet");
const RecordSheet = lazy(() => loadRecord().then((m) => ({ default: m.RecordSheet })));
const ExportSheet = lazy(() => loadExport().then((m) => ({ default: m.ExportSheet })));
const PerformanceSheet = lazy(() => loadPerformance().then((m) => ({ default: m.PerformanceSheet })));
/** Matches sheet-out in sheets.css. */
const CLOSE_MS = 180;

function close(): void {
  uiStore.set((s) => ({ ...s, sheet: null }));
}

/** Renders whichever sheet uiStore.sheet names, plus the toast region. */
export function SheetHost() {
  const live = useStore(uiStore, (s) => s.sheet);
  // A closed sheet stays mounted (inert) while it fades out, instead of vanishing in one frame.
  const [sheet, setSheet] = useState(live);
  const closing = !live && !!sheet;
  if (live && live !== sheet) setSheet(live);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setSheet(null), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [closing]);
  // The heavier sheets load when the browser is idle, so the first open never waits on the network.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000));
    idle(() => void Promise.all([loadRecord(), loadExport(), loadPerformance()]).catch(() => undefined));
  }, []);
  return (
    <>
      <ToastRegion />
      <Suspense fallback={null}>
        <div className={`sheet-host${closing ? " closing" : ""}`} {...(closing ? { inert: "" } : {})}>
        {sheet === "record" && <RecordSheet onClose={close} />}
        {sheet === "export" && <ExportSheet onClose={close} />}
        {sheet === "palette" && <PaletteSheet onClose={close} />}
        {sheet === "shortcuts" && <ShortcutsSheet onClose={close} />}
        {sheet === "performance" && <PerformanceSheet onClose={close} />}
        {sheet === "confirm" && <ConfirmSheet />}
        </div>
      </Suspense>
    </>
  );
}
