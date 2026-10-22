import { uiStore } from "../store/project";
import { toggleFullscreen, useFullscreen, fullscreenSupported } from "./appFullscreen";
import { AudioGate } from "./AudioGate";
import { Icon } from "./Icon";
import { SaveIndicator } from "./SaveIndicator";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function open(sheet: "palette" | "export"): void {
  // A recording or an export in progress must not be swapped out from under the user.
  const current = uiStore.get().sheet;
  if (current === "record" || current === "export" || current === "confirm") return;
  uiStore.set((s) => ({ ...s, sheet }));
}

export function TopBar({ compact = false }: { compact?: boolean }) {
  const full = useFullscreen();
  // Phones and tablets: the brand, a search key that opens the palette, and Export. No full-screen key, no shortcut hints.
  if (compact)
    return (
      <header className="topbar topbar-compact">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-word">
          GLCTC1
          <small>Studio</small>
        </span>
        <AudioGate />
        <span className="spacer" />
        <button type="button" className="icon-btn tb-search" onClick={() => open("palette")} aria-label="Search rooms, instruments and actions">
          <Icon name="search" size={22} />
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => open("export")}>
          Export
        </button>
      </header>
    );
  return (
    <header className="topbar">
      <button type="button" className="search-pill" onClick={() => open("palette")} aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}>
        <Icon name="search" size={18} />
        <span>Search rooms, instruments and actions</span>
        <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <span className="spacer" />
      <SaveIndicator />
      {fullscreenSupported() && (
        <button
          type="button"
          className={`icon-btn${full ? " on" : ""}`}
          onClick={() => void toggleFullscreen()}
          aria-label={full ? "Leave full screen" : "Enter full screen"}
          aria-pressed={full}
          aria-keyshortcuts={isMac ? "Meta+Shift+F" : "Control+Shift+F"}
          title={`${full ? "Leave" : "Enter"} full screen (${isMac ? "⌘⇧F" : "Ctrl+Shift+F"})`}
        >
          <Icon name="fullscreen" size={18} />
        </button>
      )}
      <button type="button" className="btn btn-primary btn-sm" onClick={() => open("export")}>
        Export
      </button>
    </header>
  );
}
