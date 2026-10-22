import type { ReactNode } from "react";
import { uiStore } from "../store/project";
import { SaveIndicator } from "./SaveIndicator";
import { TransportBar } from "./TransportBar";

/**
 * Standard room layout: header, a body that takes every remaining pixel, and the transport
 * footer. The body has min-height 0 so a room's own panels scroll instead of the page.
 */
export function RoomFrame({
  eyebrow,
  title,
  actions,
  children,
  footerExtra,
  hideTransport,
}: {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  footerExtra?: ReactNode;
  hideTransport?: boolean;
}) {
  return (
    <div className="room">
      <header className="room-head">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
        </div>
        <div className="room-actions">
          {actions}
          <SaveIndicator />
        </div>
      </header>
      <div className="room-body">{children}</div>
      {!hideTransport && <TransportBar onRecord={() => uiStore.set((s) => ({ ...s, sheet: "record" }))}>{footerExtra}</TransportBar>}
    </div>
  );
}
