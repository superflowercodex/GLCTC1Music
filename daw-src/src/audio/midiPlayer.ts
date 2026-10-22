import type { Instrument } from "./types";
import type { Project } from "../project/model";
import type { ScheduledClips } from "./clipPlayer";
import { createTicker } from "./clock";

export interface MidiScheduleOptions {
  instrumentFor(slotId: string): Instrument | undefined;
  /** Project time in seconds to start from. */
  fromSec: number;
  /** Audio-clock time that corresponds to fromSec. */
  atTime: number;
  /** How far ahead of the audio clock notes are handed to instruments; defaults to 1.5 s. */
  lookaheadSec?: number;
}

interface PlannedNote {
  /** Project seconds. */
  at: number;
  durationSec: number;
  note: number;
  velocity: number;
  instrument: Instrument;
}

const DEFAULT_LOOKAHEAD_SEC = 1.5;
const TICK_MS = 50;

/**
 * Every note of every midi clip on an instrument track that starts inside [windowStart, windowEnd),
 * ordered by start. Notes that run past the window are shortened so a loop never leaks into its next pass.
 */
function planNotes(
  project: Project,
  instrumentFor: MidiScheduleOptions["instrumentFor"],
  windowStart: number,
  windowEnd: number,
): PlannedNote[] {
  const stepSec = 60 / project.bpm / 4;
  const barSec = (project.beatsPerBar * 60) / project.bpm;
  const planned: PlannedNote[] = [];
  for (const track of project.tracks) {
    if (track.kind !== "instrument" || track.muted || !track.slotId) continue;
    const instrument = instrumentFor(track.slotId);
    if (!instrument) continue;
    for (const clip of track.clips) {
      if (clip.kind !== "midi" || !clip.notes?.length) continue;
      const clipStart = (clip.startBar - 1) * barSec;
      const clipEnd = clipStart + clip.lengthBars * barSec;
      for (const n of clip.notes) {
        const at = clipStart + n.startStep * stepSec;
        if (at < windowStart || at >= windowEnd || at >= clipEnd) continue;
        const end = Math.min(at + n.lengthSteps * stepSec, clipEnd, windowEnd);
        planned.push({ at, durationSec: end - at, note: n.pitch, velocity: n.velocity, instrument });
      }
    }
  }
  return planned.sort((a, b) => a.at - b.at);
}

function loopWindow(project: Project): { start: number; end: number } | undefined {
  if (!project.loop.on) return undefined;
  const barSec = (project.beatsPerBar * 60) / project.bpm;
  const start = (project.loop.startBar - 1) * barSec;
  const end = (project.loop.endBar - 1) * barSec;
  return end > start ? { start, end } : undefined;
}

/**
 * Plays midi clips through the instruments of their tracks. Notes are handed over a short way ahead of
 * the audio clock rather than all at once, so stopping can still cancel everything that has not sounded.
 * With the project loop on, the loop region repeats until stop().
 */
export function scheduleMidiClips(project: Project, options: MidiScheduleOptions): ScheduledClips {
  const lookahead = options.lookaheadSec ?? DEFAULT_LOOKAHEAD_SEC;
  const instruments = instrumentsWithMidi(project, options);
  const loop = loopWindow(project);
  const looping = loop !== undefined && options.fromSec < loop.end;

  let pass = planNotes(project, options.instrumentFor, options.fromSec, looping ? loop.end : Infinity);
  let index = 0;
  // Audio time of project time zero for the current pass.
  let origin = options.atTime - options.fromSec;
  let stopped = false;
  const ctx = instruments[0]?.ctx;

  const pump = (): void => {
    if (stopped || !ctx) return;
    const horizon = ctx.currentTime + lookahead;
    for (;;) {
      while (index < pass.length && origin + pass[index].at < horizon) {
        const p = pass[index++];
        p.instrument.noteOn({
          note: p.note,
          velocity: p.velocity,
          time: Math.max(origin + p.at, ctx.currentTime),
          duration: p.durationSec,
        });
      }
      if (index < pass.length || !looping) return;
      // The next pass starts where this one ended on the audio clock.
      const passEndAudio = origin + loop.end;
      if (passEndAudio >= horizon) return;
      origin = passEndAudio - loop.start;
      pass = planNotes(project, options.instrumentFor, loop.start, loop.end);
      index = 0;
    }
  };

  pump();
  const ticker = createTicker(TICK_MS);
  if (looping || index < pass.length) ticker.start(pump);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      ticker.stop();
      for (const instrument of instruments) instrument.allNotesOff();
    },
  };
}

function instrumentsWithMidi(project: Project, options: MidiScheduleOptions): Instrument[] {
  const found = new Set<Instrument>();
  for (const track of project.tracks) {
    if (track.kind !== "instrument" || !track.slotId || !track.clips.some((c) => c.kind === "midi")) continue;
    const instrument = options.instrumentFor(track.slotId);
    if (instrument) found.add(instrument);
  }
  return [...found];
}
