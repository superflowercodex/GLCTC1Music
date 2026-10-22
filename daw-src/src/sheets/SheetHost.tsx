import { lazy, Suspense } from "react";
import { uiStore } from "../store/project";
import { useStore } from "../store/store";
import { ConfirmSheet } from "./ConfirmSheet";
import { PaletteSheet } from "./PaletteSheet";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { ToastRegion } from "./Toast";
import "./sheets.css";

// Record, export and the performance recorder pull in the recorder and the offline renderer, so they load on first use.
const RecordSheet = lazy(() => import("./RecordSheet").then((m) => ({ default: m.RecordSheet })));
const ExportSheet = lazy(() => import("./ExportSheet").then((m) => ({ default: m.ExportSheet })));
const PerformanceSheet = lazy(() => import("./PerformanceSheet").then((m) => ({ default: m.PerformanceSheet })));

function close(): void {
  uiStore.set((s) => ({ ...s, sheet: null }));
}

/** Renders whichever sheet uiStore.sheet names, plus the toast region. */
export function SheetHost() {
  const sheet = useStore(uiStore, (s) => s.sheet);
  return (
    <>
      <ToastRegion />
      <Suspense fallback={null}>
        {sheet === "record" && <RecordSheet onClose={close} />}
        {sheet === "export" && <ExportSheet onClose={close} />}
        {sheet === "palette" && <PaletteSheet onClose={close} />}
        {sheet === "shortcuts" && <ShortcutsSheet onClose={close} />}
        {sheet === "performance" && <PerformanceSheet onClose={close} />}
        {sheet === "confirm" && <ConfirmSheet />}
      </Suspense>
    </>
  );
}
