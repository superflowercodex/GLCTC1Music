import { useEffect, type ReactNode } from "react";
import { uiStore } from "../store/project";
import { installTooltips } from "./tooltip";
import { TransportBar } from "./TransportBar";

/**
 * Standard room layout: a one-line header (tracked eyebrow beside a display title), a body that takes
 * every remaining pixel, and the floating transport. The body has min-height 0 so a room's own panels
 * scroll instead of the page.
 */
export function RoomFrame({
  eyebrow,
  title,
  titleAccent,
  actions,
  children,
  footerExtra,
  hideTransport,
  head,
}: {
  /** Shown after "Studio ·", e.g. an instrument's tagline. */
  eyebrow?: string;
  title: string;
  /** A trailing word drawn in the brand gradient, as the platform does with "Cosmic 1200". */
  titleAccent?: string;
  actions?: ReactNode;
  children: ReactNode;
  footerExtra?: ReactNode;
  hideTransport?: boolean;
  /** Replaces the eyebrow and title, e.g. the project header in Arrange and Song. */
  head?: ReactNode;
}) {
  useEffect(installTooltips, []);
  return (
    <div className="room">
      <header className="room-head">
        {head ?? (
          <div className="room-title">
            <span className="eyebrow">{eyebrow ? `Studio · ${eyebrow}` : "Studio"}</span>
            <h1>
              {title}
              {titleAccent && <span className="agrad-text"> {titleAccent}</span>}
            </h1>
          </div>
        )}
        <div className="room-actions">{actions}</div>
      </header>
      <div className="room-body">{children}</div>
      {!hideTransport && <TransportBar onRecord={() => uiStore.set((s) => ({ ...s, sheet: "record" }))}>{footerExtra}</TransportBar>}
    </div>
  );
}
