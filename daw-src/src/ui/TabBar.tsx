import type { Route } from "../rooms";
import { Icon, type IconName } from "./Icon";

const TABS: ReadonlyArray<{ room: Route["room"]; href: string; label: string; icon: IconName }> = [
  { room: "arrange", href: "#/arrange", label: "Arrange", icon: "arrange" },
  { room: "mix", href: "#/mix", label: "Mix", icon: "mixer" },
  { room: "song", href: "#/song", label: "Song", icon: "song" },
  { room: "stage", href: "#/stage", label: "Stage", icon: "stage" },
  { room: "play", href: "#/play", label: "Play", icon: "pads" },
  { room: "library", href: "#/library", label: "Library", icon: "library" },
];

/**
 * The phone and tablet navigation: the sidebar's rooms as a bottom tab bar. Instruments live under Play
 * (the hub lists all eight), so the bar never needs more than six whole tabs.
 */
export function TabBar({ route, onIntent }: { route: Route; onIntent?: (href: string) => void }) {
  return (
    <nav className="tabbar" aria-label="Rooms">
      {TABS.map((t) => (
        <a key={t.room} href={t.href} className="tab" aria-current={route.room === t.room ? "page" : undefined} onPointerDown={() => onIntent?.(t.href)}>
          <Icon name={t.icon} size={22} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
