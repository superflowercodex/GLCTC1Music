import { useSyncExternalStore } from "react";

/**
 * How much room the studio has. Desktop keeps the sidebar layout untouched; tablet and phone swap the
 * sidebar for a bottom tab bar, and phone also stacks every multi-pane room into one column.
 */
export type LayoutMode = "desktop" | "tablet" | "phone";

/** Above this width the desktop layout applies, pixel for pixel. */
export const COMPACT_MAX_W = 1000;
/** Portrait phones and small Android handsets. */
export const PHONE_MAX_W = 640;
/** A landscape phone is wide but too short for side-by-side panes. */
export const PHONE_MAX_H = 500;

/* These strings must match the media queries in ui/mobile.css. */
export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_W}px)`;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_W}px), (max-width: ${COMPACT_MAX_W}px) and (max-height: ${PHONE_MAX_H}px)`;

export class LayoutSizeError extends Error {}

export function layoutModeFor(width: number, height: number): LayoutMode {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new LayoutSizeError(`Not a viewport size: ${width}x${height}`);
  if (width > COMPACT_MAX_W) return "desktop";
  if (width <= PHONE_MAX_W || height <= PHONE_MAX_H) return "phone";
  return "tablet";
}

function current(): LayoutMode {
  if (typeof innerWidth === "undefined" || innerWidth <= 0 || innerHeight <= 0) return "desktop";
  return layoutModeFor(innerWidth, innerHeight);
}

function subscribe(listener: () => void): () => void {
  addEventListener("resize", listener);
  addEventListener("orientationchange", listener);
  return () => {
    removeEventListener("resize", listener);
    removeEventListener("orientationchange", listener);
  };
}

export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, current, () => "desktop");
}

function narrow(): boolean {
  return typeof innerWidth !== "undefined" && innerWidth > 0 && innerWidth <= PHONE_MAX_W;
}

/** True on a portrait phone: too narrow for sixteen finger-sized steps in a row (a landscape phone has room). */
export function useNarrowPhone(): boolean {
  return useSyncExternalStore(subscribe, narrow, () => false);
}

export const isCompact = (mode: LayoutMode): boolean => mode !== "desktop";
