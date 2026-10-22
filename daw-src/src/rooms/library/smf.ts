import type { Note } from "../../project/model";

export class MidiFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MidiFileError";
  }
}

export interface ParsedMidiFile {
  bpm: number;
  bars: number;
  /** Positions are in 16th steps from the start of the file. */
  notes: Note[];
}

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}
  get done(): boolean {
    return this.pos >= this.bytes.length;
  }
  u8(): number {
    const v = this.bytes[this.pos++];
    if (v === undefined) throw new MidiFileError("The MIDI file ends unexpectedly.");
    return v;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new MidiFileError("The MIDI file has a damaged time value.");
  }
  tag(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8());
  }
}

export function parseStandardMidiFile(bytes: Uint8Array, beatsPerBar = 4): ParsedMidiFile {
  const r = new Reader(bytes);
  if (r.tag() !== "MThd") throw new MidiFileError("This is not a MIDI file.");
  const headerLength = r.u32();
  r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.pos += Math.max(0, headerLength - 6);
  if (division & 0x8000) throw new MidiFileError("This MIDI file uses timecode timing, which is not supported.");
  const ppq = division;
  if (ppq === 0) throw new MidiFileError("This MIDI file has no timing resolution.");

  let microsPerBeat = 500_000;
  let tempoSeen = false;
  const notes: Note[] = [];
  let endTick = 0;

  for (let t = 0; t < trackCount && !r.done; t++) {
    const tag = r.tag();
    const length = r.u32();
    const end = r.pos + length;
    if (tag !== "MTrk") {
      r.pos = end;
      continue;
    }
    let tick = 0;
    let running = 0;
    const open = new Map<number, { tick: number; velocity: number }>();
    while (r.pos < end) {
      tick += r.vlq();
      let status = r.u8();
      if (status < 0x80) {
        r.pos -= 1;
        status = running;
        if (!status) throw new MidiFileError("The MIDI file has an event with no status.");
      }
      if (status === 0xff) {
        const type = r.u8();
        const len = r.vlq();
        if (type === 0x51 && len === 3 && !tempoSeen) {
          microsPerBeat = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          tempoSeen = true;
        } else {
          r.pos += len;
        }
        if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        r.pos += r.vlq();
        continue;
      }
      running = status;
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const a = r.u8();
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : r.u8();
      const key = channel * 128 + a;
      if (kind === 0x90 && b > 0) {
        open.set(key, { tick, velocity: b / 127 });
      } else if (kind === 0x80 || (kind === 0x90 && b === 0)) {
        const started = open.get(key);
        if (started) {
          open.delete(key);
          notes.push({ pitch: a, startStep: (started.tick / ppq) * 4, lengthSteps: Math.max(0.25, ((tick - started.tick) / ppq) * 4), velocity: started.velocity });
          endTick = Math.max(endTick, tick);
        }
      }
    }
    r.pos = end;
  }

  const bpm = Math.round((60_000_000 / microsPerBeat) * 100) / 100;
  const bars = Math.max(1, Math.ceil(endTick / ppq / beatsPerBar));
  notes.sort((x, y) => x.startStep - y.startStep || x.pitch - y.pitch);
  return { bpm, bars, notes };
}
