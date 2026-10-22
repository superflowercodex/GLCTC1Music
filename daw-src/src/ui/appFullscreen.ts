import { useEffect, useState } from "react";

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = (): FsDocument | undefined => (typeof document === "undefined" ? undefined : (document as FsDocument));

export function fullscreenSupported(): boolean {
  const d = doc();
  return !!d && (d.fullscreenEnabled || "webkitExitFullscreen" in d);
}

export function isFullscreen(): boolean {
  const d = doc();
  return !!d && !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Puts the whole studio full screen (or brings it back). A refusal, such as a blocked request, leaves the window as it was. */
export async function toggleFullscreen(): Promise<void> {
  const d = doc();
  if (!d) return;
  try {
    if (isFullscreen()) {
      if (d.exitFullscreen) await d.exitFullscreen();
      else await d.webkitExitFullscreen?.();
    } else {
      const root = d.documentElement as FsElement;
      if (root.requestFullscreen) await root.requestFullscreen();
      else await root.webkitRequestFullscreen?.();
    }
  } catch {
    // The browser said no (no user gesture, or an embedded frame): nothing to undo.
  }
}

export function useFullscreen(): boolean {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);
  return on;
}
