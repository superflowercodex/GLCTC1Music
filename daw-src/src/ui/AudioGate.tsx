import { useEffect, useState } from "react";
import { getEngine, peekEngine, whenEngine } from "../audio/engine";
import { installAudioUnlock, preferPlaybackSession } from "../audio/unlock";

/**
 * Phones and tablets: every tap resumes a suspended AudioContext (iOS only lets audio start inside a
 * gesture), and while sound is still asleep a small "Start audio" key in the top bar says so. Desktop never mounts it.
 */
export function AudioGate() {
  const [asleep, setAsleep] = useState(false);

  useEffect(() => {
    preferPlaybackSession(typeof navigator === "undefined" ? undefined : navigator);
    const off = installAudioUnlock(document, () => {
      const ctx = peekEngine()?.ctx;
      return ctx instanceof AudioContext ? ctx : undefined;
    });
    let ctx: AudioContext | undefined;
    const sync = () => setAsleep(!!ctx && ctx.state !== "running" && ctx.state !== "closed");
    const stop = whenEngine((engine) => {
      if (!(engine.ctx instanceof AudioContext)) return;
      ctx = engine.ctx;
      ctx.addEventListener("statechange", sync);
      sync();
    });
    return () => {
      off();
      stop();
      ctx?.removeEventListener("statechange", sync);
    };
  }, []);

  if (!asleep) return null;
  return (
    <button type="button" className="audio-gate" onClick={() => void getEngine().resume().catch(() => undefined)}>
      <span className="audio-gate-dot" aria-hidden="true" />
      Start audio
    </button>
  );
}
