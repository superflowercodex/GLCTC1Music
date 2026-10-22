import { bounceInstrument, measure } from "../../../audio/bounce";
import { instrumentInfo } from "../../../audio/instruments/registry";
import { Looper } from "../../../audio/instruments/looper";
import { Vox } from "../../../audio/instruments/vox";
import { addBouncedTrack } from "../../../audio/instruments/voice/bounceToTrack";
import { toast, toastError } from "../../../audio/instruments/voice/notify";
import type { Instrument, InstrumentState } from "../../../audio/types";
import { projectStore } from "../../../store/project";

async function renderToTrack(create: (ctx: BaseAudioContext) => Instrument, state: InstrumentState, bars: number, name: string, color: string): Promise<void> {
  try {
    const { bpm, beatsPerBar } = projectStore.get();
    const buffer = await bounceInstrument(create, state, { bars, bpm, beatsPerBar, tailSeconds: 2 });
    if (measure(buffer).peak < 1e-4) {
      toast("Nothing to bounce yet. Play some notes or start a loop first.");
      return;
    }
    await addBouncedTrack(buffer, name, color);
    toast(`Bounced ${bars} ${bars === 1 ? "bar" : "bars"} to a new track: ${name}`);
  } catch (error) {
    toastError(error, "The bounce failed.");
  }
}

/** Renders the recorded MIDI take (keys, choir, piano, pads) to an audio track. */
export async function bounceVox(vox: Vox): Promise<void> {
  if (vox.take.length === 0) {
    toast("Record MIDI first, then bounce it. Live input is recorded with Record audio.");
    return;
  }
  await vox.ready();
  const barSteps = projectStore.get().beatsPerBar * 4;
  await renderToTrack((ctx) => new Vox(ctx), vox.serialize(), Math.ceil(vox.takeSteps / barSteps), "Galactic Vox bounce", instrumentInfo("vox").color);
}

/** Renders the active scene, the recorded performance and any loops running right now. */
export async function bounceLooper(looper: Looper): Promise<void> {
  await looper.ready();
  await renderToTrack((ctx) => new Looper(ctx), looper.snapshotForBounce(), looper.getParam("bounceBars"), "Looper bounce", instrumentInfo("looper").color);
}
