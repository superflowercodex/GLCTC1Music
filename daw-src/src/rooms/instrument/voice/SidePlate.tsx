import { useRef, type ReactNode } from "react";
import { useEdgeFade } from "../../../ui/useEdgeFade";

/** The right-hand pane: a printed heading, then knobs on a scroller whose edges dissolve. */
export function SidePlate({ eyebrow, title, blurb, children, bodyClass = "" }: { eyebrow: string; title: string; blurb?: string; children: ReactNode; bodyClass?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEdgeFade(scroller, "y");
  return (
    <div className="vx-side hw-plate">
      <div className="vx-side-head">
        <div className="voice-label">{eyebrow}</div>
        <div className="module-title">{title}</div>
        {blurb && <div className="module-blurb">{blurb}</div>}
      </div>
      <div ref={scroller} className={`module-body scroll-y fade-y knob-grid ${bodyClass}`}>
        {children}
      </div>
    </div>
  );
}
