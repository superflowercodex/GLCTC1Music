import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { parseRoute, type Route } from "./rooms";
import { MidiLearnBadge } from "./rooms/library/MidiLearnBadge";
import { SheetHost } from "./sheets/SheetHost";
import { Sidebar, useSideMode } from "./ui/Sidebar";
import { TopBar } from "./ui/TopBar";
import { enterRoom, glideSidebar, transitionRoom } from "./ui/roomMotion";
import type { InstrumentKind } from "./audio/types";
import { INSTRUMENTS } from "./audio/instruments/registry";
import { Cosmos } from "./gfx/Cosmos";
import { ambienceFor, roomAccent } from "./gfx/ambience";
import { useProjectPalette } from "./gfx/useProjectPalette";

type RoomKey = "arrange" | "instruments" | "instrument" | "mix" | "song" | "stage" | "library";
type AnyRoom = ComponentType<any>;

const LOADERS: Record<RoomKey, () => Promise<{ default: AnyRoom }>> = {
  arrange: () => import("./rooms/Arrange"),
  instruments: () => import("./rooms/Instruments"),
  instrument: () => import("./rooms/InstrumentRoom"),
  mix: () => import("./rooms/Mixer"),
  song: () => import("./rooms/Song"),
  stage: () => import("./rooms/Stage"),
  library: () => import("./rooms/Library"),
};

// Rooms already fetched render directly: React.lazy suspends once even for a loaded module, and a
// suspended frame inside a view transition would cross-fade into an empty stage.
const loaded = new Map<RoomKey, AnyRoom>();
function loadRoom(key: RoomKey): Promise<AnyRoom> {
  const ready = loaded.get(key);
  if (ready) return Promise.resolve(ready);
  return LOADERS[key]().then((m) => {
    loaded.set(key, m.default);
    return m.default;
  });
}
const lazyRoom = (key: RoomKey) => lazy(() => loadRoom(key).then((c) => ({ default: c })));
const LAZY: Record<RoomKey, AnyRoom> = {
  arrange: lazyRoom("arrange"),
  instruments: lazyRoom("instruments"),
  instrument: lazyRoom("instrument"),
  mix: lazyRoom("mix"),
  song: lazyRoom("song"),
  stage: lazyRoom("stage"),
  library: lazyRoom("library"),
};
const roomComponent = (key: RoomKey): AnyRoom => loaded.get(key) ?? LAZY[key];

function instrumentKind(route: Route): InstrumentKind | undefined {
  return route.room === "play" ? (INSTRUMENTS.find((i) => i.kind === route.sub)?.kind as InstrumentKind | undefined) : undefined;
}

function roomKey(route: Route): RoomKey {
  if (route.room === "play") return instrumentKind(route) ? "instrument" : "instruments";
  return route.room;
}

function RoomView({ route }: { route: Route }) {
  const kind = instrumentKind(route);
  const Room = roomComponent(roomKey(route));
  return kind ? <Room key={kind} kind={kind} /> : <Room />;
}

const sameRoute = (a: Route, b: Route) => a.room === b.room && a.sub === b.sub;
/** Same mounted room (a different sub-route re-renders it in place), so there is nothing to dissolve. */
const sameRoom = (a: Route, b: Route) => roomKey(a) === roomKey(b) && instrumentKind(a) === instrumentKind(b);

/** Warms a room's code before it is opened, e.g. when the pointer reaches its nav item. */
export function prefetchRoom(hash: string): void {
  void loadRoom(roomKey(parseRoute(hash))).catch(() => undefined);
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const stageRef = useRef<HTMLElement>(null);
  const entered = useRef(false);
  // The first room settles in once it is on screen (it may arrive a frame later from its lazy chunk).
  useLayoutEffect(() => {
    if (entered.current || !stageRef.current) return;
    const stage = stageRef.current;
    const tryEnter = () => {
      if (entered.current || !stage.querySelector(":scope > .room")) return false;
      entered.current = true;
      enterRoom(stage);
      return true;
    };
    if (tryEnter()) return;
    const mo = new MutationObserver(() => tryEnter() && mo.disconnect());
    mo.observe(stage, { childList: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    let current = parseRoute(location.hash);
    let shown = current;
    const onHash = () => {
      const next = parseRoute(location.hash);
      if (sameRoute(next, current)) return;
      current = next;
      void loadRoom(roomKey(next)).then(() => {
        // A later hash change won while this room was loading.
        if (current !== next) return;
        const prev = shown;
        shown = next;
        const apply = () => flushSync(() => setRoute(next));
        const stage = stageRef.current;
        if (sameRoom(prev, next) || !stage) apply();
        else transitionRoom(stage, apply);
      }, (e: unknown) => {
        console.error(e);
        shown = next;
        setRoute(next);
      });
    };
    addEventListener("hashchange", onHash);
    // Fetch every room once the first one is on screen, so later room changes never wait on the network.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    idle(() => {
      for (const key of Object.keys(LOADERS) as RoomKey[]) void loadRoom(key).catch(() => undefined);
    });
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const [sideMode, toggleSide] = useSideMode();
  const shellRef = useRef<HTMLDivElement>(null);
  const onToggleSide = () => {
    const shell = shellRef.current;
    if (shell) glideSidebar(shell, () => flushSync(toggleSide));
    else toggleSide();
  };
  // The open project drives the light: its palette tints buttons, nav, chips and the nebula, leaned a little
  // toward each room's own hue. An instrument room is a single-colour device, lit in the instrument's colour.
  const palette = useProjectPalette();
  const tint = route.room === "play" ? INSTRUMENTS.find((i) => i.kind === route.sub)?.color : undefined;
  const ambience = useMemo(() => ambienceFor(route, tint, palette), [route, tint, palette]);
  const accents = { "--a1": tint ?? roomAccent(route, palette), "--a2": palette.a2, "--a3": palette.a3, "--pa1": palette.a1 } as CSSProperties;

  return (
    <div ref={shellRef} className="shell" data-side={sideMode} style={accents}>
      <Cosmos ambience={ambience} />
      <Sidebar route={route} mode={sideMode} onToggle={onToggleSide} onIntent={prefetchRoom} />
      <TopBar />
      <main ref={stageRef} className="stage">
        <Suspense fallback={null}>
          <RoomView route={route} />
        </Suspense>
      </main>
      <MidiLearnBadge />
      <SheetHost />
    </div>
  );
}
