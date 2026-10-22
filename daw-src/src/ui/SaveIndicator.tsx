import { useEffect, useState } from "react";
import { describeSaveStatus, persistence, saveStatusStore } from "../project/persist";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";

const SHORT = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved" } as const;

/** Project name and save state in the room header. The width is fixed so the text changing never moves the header. */
export function SaveIndicator() {
  const name = useStore(projectStore, (p) => p.name);
  const status = useStore(saveStatusStore, (s) => s);
  const [, tick] = useState(0);

  // "Saved 3 minutes ago" is only in the tooltip, but keep it fresh while it is visible.
  useEffect(() => {
    if (status.state !== "saved") return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [status.state]);

  return (
    <div className="save-ind" title={describeSaveStatus(status)}>
      <span className="save-name">{name}</span>
      <span className={`save-state ${status.state}`} role="status" aria-live="polite">
        {SHORT[status.state]}
      </span>
      {status.state === "error" && (
        <button type="button" className="save-retry" onClick={() => void persistence().saveNow().catch(() => undefined)}>
          Retry
        </button>
      )}
    </div>
  );
}
