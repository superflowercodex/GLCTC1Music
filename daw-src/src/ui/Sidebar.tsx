import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { INSTRUMENTS } from "../audio/instruments/registry";
import type { Route } from "../rooms";
import { lsGet, lsSet } from "../storage";
import { Icon, type IconName } from "./Icon";
import { motionAllowed, ROOM_IN_MS } from "./roomMotion";

type SideMode = "open" | "mini";

const KEY = "sidebar";
/** Below this width the sidebar starts as an icon rail unless the user chose otherwise. */
export const RAIL_BELOW_PX = 1400;

function autoMode(): SideMode {
  return typeof innerWidth !== "undefined" && innerWidth < RAIL_BELOW_PX ? "mini" : "open";
}

/** Remembered choice wins; with none stored the mode follows the window width. */
export function useSideMode(): [SideMode, () => void] {
  const [chosen, setChosen] = useState<SideMode | null>(() => lsGet<SideMode | null>(KEY, null));
  const [auto, setAuto] = useState<SideMode>(autoMode);
  useEffect(() => {
    if (chosen) return;
    const onResize = () => setAuto(autoMode());
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [chosen]);
  const mode = chosen ?? auto;
  const toggle = () => {
    const next: SideMode = mode === "open" ? "mini" : "open";
    lsSet(KEY, next);
    setChosen(next);
  };
  return [mode, toggle];
}

interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  color?: string;
  active: boolean;
}

function NavLink({ item, mini, onIntent }: { item: NavItem; mini: boolean; onIntent?: (href: string) => void }) {
  return (
    <a href={item.href} className="side-link" onPointerEnter={() => onIntent?.(item.href)} onFocus={() => onIntent?.(item.href)} aria-current={item.active ? "page" : undefined} title={mini ? item.label : undefined} style={item.color ? ({ "--c": item.color } as CSSProperties) : undefined}>
      {/* The lit indicator is its own element so it can glide from item to item. */}
      {item.active && <span className="side-ind" aria-hidden="true" />}
      {item.icon ? (
        <Icon name={item.icon} size={20} />
      ) : (
        <span className="side-glyph" aria-hidden="true">
          {item.label.replace(/^Galactic /, "").charAt(0)}
        </span>
      )}
      <span className="side-text">{item.label}</span>
    </a>
  );
}

/**
 * Glides the lit indicator from the item it left to the one it lands on (transform only, so the glass
 * sidebar keeps blurring), instead of fading a new one in. The first indicator fades in on its own.
 */
function useIndicatorGlide(nav: RefObject<HTMLElement>, active: string) {
  const prev = useRef(active);
  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = active;
    const root = nav.current;
    if (!root || from === active || !motionAllowed()) return;
    // The item it left is still in the list, so measure it now, in the current layout.
    const left = [...root.querySelectorAll<HTMLAnchorElement>("a.side-link")].find((a) => a.getAttribute("href") === from);
    const ind = root.querySelector<HTMLElement>(".side-ind");
    if (!left || !ind) return;
    const a = left.getBoundingClientRect();
    const b = ind.getBoundingClientRect();
    for (const anim of ind.getAnimations()) anim.cancel();
    ind.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }], { duration: ROOM_IN_MS, easing: "cubic-bezier(.22, 1, .36, 1)" });
  }, [active]);
}

export function Sidebar({ route, mode, onToggle, onIntent }: { route: Route; mode: SideMode; onToggle: () => void; onIntent?: (href: string) => void }) {
  const nav = useRef<HTMLElement>(null);
  const at = (room: Route["room"]) => route.room === room;
  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "Create",
      items: [
        { href: "#/arrange", label: "Arrange", icon: "arrange", active: at("arrange") },
        { href: "#/mix", label: "Mix", icon: "mixer", active: at("mix") },
        { href: "#/song", label: "Song", icon: "song", active: at("song") },
        { href: "#/stage", label: "Stage", icon: "stage", active: at("stage") },
      ],
    },
    {
      label: "Instruments",
      items: [
        { href: "#/play", label: "All instruments", icon: "pads", active: at("play") && !route.sub },
        ...INSTRUMENTS.map((i) => ({ href: `#/play/${i.kind}`, label: i.name, color: i.color, active: at("play") && route.sub === i.kind })),
      ],
    },
    { label: "Library", items: [{ href: "#/library", label: "Library", icon: "library", active: at("library") }] },
  ];
  const active = groups.flatMap((g) => g.items).find((i) => i.active)?.href ?? "";
  useIndicatorGlide(nav, active);

  return (
    <aside className="side" data-mode={mode} aria-label="Studio">
      <div className="side-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-word">
          GLCTC1
          <small>Studio</small>
        </span>
        <button type="button" className="side-toggle" onClick={onToggle} aria-label={mode === "open" ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={mode === "open"} title={mode === "open" ? "Collapse sidebar" : "Expand sidebar"}>
          <Icon name="back" size={16} />
        </button>
      </div>
      <nav ref={nav} className="side-nav" aria-label="Rooms">
        {groups.map((g) => (
          <div key={g.label} className="side-group" role="group" aria-label={g.label}>
            <div className="side-group-label" aria-hidden="true">
              {g.label}
            </div>
            {g.items.map((item) => (
              <NavLink key={item.href} item={item} mini={mode === "mini"} onIntent={onIntent} />
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
