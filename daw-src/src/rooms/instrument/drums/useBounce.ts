import { useCallback, useState } from "react";
import { bounceDrumToTrack } from "../../../audio/instruments/drums/bounceToTrack";
import type { DrumBase } from "../../../audio/instruments/drums/drumBase";
import type { Instrument } from "../../../audio/types";

export function useBounce(instrument: DrumBase, create: (ctx: BaseAudioContext) => Instrument, name: string, bars: () => number) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      await bounceDrumToTrack(instrument, create, name, bars());
    } finally {
      setBusy(false);
    }
  }, [instrument, create, name, bars]);
  return { busy, run };
}
