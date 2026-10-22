import type { ReactNode } from "react";

/** Tracked uppercase display-font label that heads a control group, with optional quiet detail on the right. */
export function Caption({ children, aside, as: Tag = "div", id, className = "" }: { children: ReactNode; aside?: ReactNode; as?: "div" | "h2" | "h3" | "span"; id?: string; className?: string }) {
  return (
    <Tag className={`caption ${className}`} id={id}>
      <span className="caption-t">{children}</span>
      {aside !== undefined && <span className="caption-s">{aside}</span>}
    </Tag>
  );
}
