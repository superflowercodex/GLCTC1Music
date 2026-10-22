import { prefersReducedMotion } from "./hooks";

/*
 * Room changes as a fade-through that never stops the glass from blurring.
 *
 * A backdrop-filter only sees the nebula when no ancestor is a backdrop root, and an ancestor with
 * opacity < 1, a filter, a mask or a view-transition-name is one. Fading (or view-transition capturing) a
 * whole room therefore shows every glass pane as clear, unblurred tint for the length of the transition,
 * and the blur snaps back at the end. So instead of fading the room, we fade the outermost pieces that are
 * either glass themselves (an element's own opacity does not affect its own backdrop) or hold no glass at
 * all, and walk through the wrappers in between. Transform is not a backdrop-root trigger, so the zoom is
 * applied to the same pieces around the room's centre.
 *
 * It is a fade-through, not a cross-fade: the live old room dissolves into the nebula (120ms), then the new
 * one dissolves in (320ms). Measured on the Mixer, Arrange and instrument rooms, a cross-fade (a cloned
 * outgoing room over the new one) doubled the glass to blur and re-raster each frame and dropped 3-5x more
 * frames than this; a zoom on top of the fade dropped twice as many as the fade alone, because every
 * moving pane has to resample its backdrop each frame. Opacity alone keeps the panes still.
 */

const EASE_OUT = "cubic-bezier(.22, 1, .36, 1)";
const EASE_IN = "cubic-bezier(.4, 0, .7, .2)";
export const ROOM_IN_MS = 320;
export const ROOM_OUT_MS = 120;

/** Ends a transition early when frames run long, so a busy machine gets an instant swap instead of a stutter. */
export class SlowFrameGuard {
  private slow = 0;
  constructor(
    private readonly limitMs = 50,
    private readonly maxSlow = 2,
  ) {}
  /** Feed one frame's duration; true once the transition should give up. */
  frame(ms: number): boolean {
    if (ms > this.limitMs * 2) return true;
    this.slow = ms > this.limitMs ? this.slow + 1 : 0;
    return this.slow >= this.maxSlow;
  }
}

interface Piece {
  el: Element;
  pseudo?: "::before" | "::after";
}

const hasBackdrop = (cs: CSSStyleDeclaration): boolean => {
  const v = cs.backdropFilter || (cs as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter;
  return !!v && v !== "none";
};
const paints = (cs: CSSStyleDeclaration): boolean => cs.content !== "none" && cs.content !== "normal" && cs.display !== "none";

/** The pieces to animate so that no glass element ever sits inside an element whose opacity changes. */
export function fadePieces(root: Element): Piece[] {
  const ownGlass = new Set<Element>();
  const walkThrough = new Set<Element>();
  const mark = (el: Element | null) => {
    for (let n = el; n && n !== root && !walkThrough.has(n); n = n.parentElement) walkThrough.add(n);
  };
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (hasBackdrop(getComputedStyle(el))) {
      ownGlass.add(el);
      mark(el.parentElement);
    }
    if (hasBackdrop(getComputedStyle(el, "::before")) || hasBackdrop(getComputedStyle(el, "::after"))) mark(el);
  }
  walkThrough.add(root);
  if (ownGlass.has(root)) return [{ el: root }];

  const pieces: Piece[] = [];
  const visit = (el: Element) => {
    if (ownGlass.has(el) || !walkThrough.has(el)) {
      pieces.push({ el });
      return;
    }
    for (const pseudo of ["::before", "::after"] as const) if (paints(getComputedStyle(el, pseudo))) pieces.push({ el, pseudo });
    for (const child of el.children) visit(child);
  };
  visit(root);
  return pieces;
}

const fadeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const fadeOut: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

const animatePieces = (pieces: Piece[], frames: Keyframe[], options: KeyframeAnimationOptions): Animation[] =>
  pieces.map(({ el, pseudo }) => el.animate(frames, { ...options, pseudoElement: pseudo }));

/** The transport is the same capsule in every room, so it holds still while the room around it changes. */
const isTransport = (p: Piece): boolean => !p.pseudo && p.el.classList.contains("transport");
const roomIn = (stage: HTMLElement): HTMLElement | null => stage.querySelector<HTMLElement>(":scope > .room");

export function motionAllowed(): boolean {
  return typeof document !== "undefined" && !prefersReducedMotion() && !document.hidden && typeof Element.prototype.animate === "function";
}

let running: (() => void) | null = null;
/** While the old room is fading out, a newer room change only replaces what gets swapped in. */
let pendingSwap: (() => void) | null = null;

/**
 * Swaps the room in `stage` by calling `swap` (which must render synchronously): the old room fades into
 * the nebula, then the new one fades in.
 */
export function transitionRoom(stage: HTMLElement, swap: () => void): void {
  if (pendingSwap) {
    pendingSwap = swap;
    return;
  }
  running?.();
  const oldRoom = roomIn(stage);
  if (!motionAllowed() || !oldRoom) {
    swap();
    enterRoom(stage);
    return;
  }
  const hadTransport = !!oldRoom.querySelector(".transport");
  oldRoom.inert = true;
  pendingSwap = swap;
  const out = animatePieces(fadePieces(oldRoom).filter((p) => !isTransport(p)), fadeOut, { duration: ROOM_OUT_MS, easing: EASE_IN, fill: "forwards" });
  supervise(out, () => {
    const next = pendingSwap;
    pendingSwap = null;
    next?.();
    // Going straight back to the same room keeps this element mounted.
    oldRoom.inert = false;
    enterRoom(stage, hadTransport);
  });
}

/** Fades the room in `stage` in; `keepTransport` leaves its transport still because the last room had one too. */
export function enterRoom(stage: HTMLElement, keepTransport = false): void {
  const room = roomIn(stage);
  if (!room || !motionAllowed()) return;
  const pieces = fadePieces(room).filter((p) => !(keepTransport && isTransport(p)));
  supervise(animatePieces(pieces, fadeIn, { duration: ROOM_IN_MS, easing: EASE_OUT, fill: "backwards" }), () => {});
}

function supervise(animations: Animation[], done: () => void): void {
  let raf = 0;
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    if (running === finish) running = null;
    done();
    for (const a of animations) a.cancel();
  };
  running = finish;
  const guard = new SlowFrameGuard();
  // The first frame carries the new room's mount, which is not a sign of a slow machine.
  let last = 0;
  const tick = (now: number) => {
    if (last && guard.frame(now - last)) return finish();
    last = now;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  void Promise.all(animations.map((a) => a.finished)).then(finish, finish);
}

const SIDE_MS = 320;

/**
 * Collapses or expands the sidebar without animating the grid: `apply` switches the layout at once (one
 * relayout instead of one per frame, which dropped frames in Arrange), then the room and top bar glide from
 * where they were by transform, and a widening sidebar is revealed by a clip from its old edge.
 */
export function glideSidebar(shell: HTMLElement, apply: () => void): void {
  const side = shell.querySelector<HTMLElement>(":scope > .side");
  const moving = [...shell.querySelectorAll<HTMLElement>(":scope > .stage, :scope > .topbar")];
  if (!side || !motionAllowed()) return apply();
  const sideBefore = side.getBoundingClientRect().width;
  const leftBefore = moving.map((el) => el.getBoundingClientRect().left);
  apply();
  const sideAfter = side.getBoundingClientRect().width;
  const options: KeyframeAnimationOptions = { duration: SIDE_MS, easing: EASE_OUT };
  moving.forEach((el, i) => {
    const dx = leftBefore[i] - el.getBoundingClientRect().left;
    if (dx) el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], options);
  });
  if (sideAfter > sideBefore) {
    const radius = getComputedStyle(side).borderTopRightRadius;
    side.animate([{ clipPath: `inset(0 ${sideAfter - sideBefore}px 0 0 round ${radius})` }, { clipPath: `inset(0 0 0 0 round ${radius})` }], options);
  }
}
