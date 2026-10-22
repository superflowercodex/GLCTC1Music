import { lazy, Suspense, useEffect, useState } from "react";
import { Aurora } from "./gfx/Aurora";
import { parseRoute, ROOMS, type Route } from "./rooms";
import { MidiLearnBadge } from "./rooms/library/MidiLearnBadge";
import { SheetHost } from "./sheets/SheetHost";
import { Icon, type IconName } from "./ui/Icon";
import type { InstrumentKind } from "./audio/types";
import { INSTRUMENTS } from "./audio/instruments/registry";

const Arrange = lazy(() => import("./rooms/Arrange"));
const Instruments = lazy(() => import("./rooms/Instruments"));
const InstrumentRoom = lazy(() => import("./rooms/InstrumentRoom"));
const Mixer = lazy(() => import("./rooms/Mixer"));
const Song = lazy(() => import("./rooms/Song"));
const Stage = lazy(() => import("./rooms/Stage"));
const Library = lazy(() => import("./rooms/Library"));

const RAIL_ICONS: Record<string, IconName> = { arrange: "arrange", play: "pads", mix: "mixer", song: "song", stage: "stage", library: "library" };

function RoomView({ route }: { route: Route }) {
  switch (route.room) {
    case "arrange":
      return <Arrange />;
    case "play": {
      const kind = INSTRUMENTS.find((i) => i.kind === route.sub)?.kind as InstrumentKind | undefined;
      return kind ? <InstrumentRoom key={kind} kind={kind} /> : <Instruments />;
    }
    case "mix":
      return <Mixer />;
    case "song":
      return <Song />;
    case "stage":
      return <Stage />;
    case "library":
      return <Library />;
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="shell">
      <div className="backdrop" />
      <Aurora />
      <nav className="rail" aria-label="Rooms">
        <div className="logo">G</div>
        {ROOMS.map((r) => (
          <a key={r.id} href={`#/${r.id}`} className={r.id === route.room ? "rail-item on" : "rail-item"} aria-label={r.title} aria-current={r.id === route.room ? "page" : undefined}>
            <Icon name={RAIL_ICONS[r.id]} size={24} />
            <span>{r.label}</span>
          </a>
        ))}
      </nav>
      <main style={{ minHeight: 0, minWidth: 0, display: "grid" }}>
        <Suspense fallback={null}>
          <RoomView route={route} />
        </Suspense>
      </main>
      <MidiLearnBadge />
      <SheetHost />
    </div>
  );
}
