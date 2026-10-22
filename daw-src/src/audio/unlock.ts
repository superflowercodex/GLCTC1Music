/** The part of an AudioContext the unlock needs, so it can be tested without a browser. */
export interface ResumableContext {
  readonly state: string;
  resume(): Promise<void>;
}

/**
 * iOS Safari (and Chrome on Android) start every AudioContext suspended and only let it run when resume()
 * is called inside a user gesture. Rooms resume on play, but a pad, key or knob may be the first touch, so
 * every tap anywhere resumes a suspended context. Listeners are passive and in the capture phase: they never
 * delay or swallow the tap. They stay installed, because iOS suspends the context again after an interruption
 * (a call, Siri, another app's audio).
 */
export const UNLOCK_EVENTS = ["pointerdown", "touchend", "click", "keydown"] as const;

export function installAudioUnlock(target: EventTarget, context: () => ResumableContext | undefined): () => void {
  const onGesture = (): void => {
    const ctx = context();
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => undefined);
  };
  for (const type of UNLOCK_EVENTS) target.addEventListener(type, onGesture, { capture: true, passive: true });
  return () => {
    for (const type of UNLOCK_EVENTS) target.removeEventListener(type, onGesture, { capture: true });
  };
}

/** iOS mutes Web Audio with the ring/silent switch unless the page says it plays media (Safari 16.4+). */
export function preferPlaybackSession(nav: Navigator | undefined): void {
  const session = (nav as (Navigator & { audioSession?: { type: string } }) | undefined)?.audioSession;
  if (session && session.type !== "playback") session.type = "playback";
}
