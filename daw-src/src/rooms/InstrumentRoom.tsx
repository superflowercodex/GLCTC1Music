import { Suspense, useEffect, useState } from "react";
import { instrumentInfo } from "../audio/instruments/registry";
import type { Instrument, InstrumentKind } from "../audio/types";
import { ensureInstrument } from "../project/instruments";

export default function InstrumentRoom({ kind }: { kind: InstrumentKind }) {
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const info = instrumentInfo(kind);

  useEffect(() => {
    let live = true;
    setInstrument(null);
    void ensureInstrument(kind).then((i) => live && setInstrument(i));
    return () => {
      live = false;
    };
  }, [kind]);

  if (!instrument) return <div className="room"><p className="eyebrow">Loading {info.name}…</p></div>;
  return (
    <Suspense fallback={null}>
      <info.Room instrument={instrument} />
    </Suspense>
  );
}
