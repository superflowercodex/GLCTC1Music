export const KEYBOARD_HINT = "Play with the computer keyboard: A W S E D F T G Y H U J K O L.";

export type MidiEvent = { kind: "on"; pitch: number; velocity: number } | { kind: "off"; pitch: number } | { kind: "allOff" };

/** Reads one raw MIDI message; anything that is not a note or "all notes off" is ignored. */
export function parseMidiMessage(data: ArrayLike<number>): MidiEvent | undefined {
  if (data.length < 2) return undefined;
  const status = data[0] & 0xf0;
  if (status === 0x90 && (data[2] ?? 0) > 0) return { kind: "on", pitch: data[1], velocity: data[2] / 127 };
  if (status === 0x80 || status === 0x90) return { kind: "off", pitch: data[1] };
  if (status === 0xb0 && data[1] === 123) return { kind: "allOff" };
  return undefined;
}

export interface MidiConnection {
  /** What to tell the player: which keyboards are listening, or why none can. */
  message: string;
  close(): void;
}

/** Listens to every connected MIDI input, following keyboards plugged in later. Never throws: failures come back as `message`. */
export async function connectMidi(onEvent: (e: MidiEvent) => void): Promise<MidiConnection> {
  if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
    return { message: `MIDI keyboards need Chrome, Edge or Opera, so this browser can only use the computer keyboard. ${KEYBOARD_HINT}`, close() {} };
  }
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return { message: `MIDI access was blocked, so only the computer keyboard works. ${KEYBOARD_HINT}`, close() {} };
  }
  const handler = (msg: MIDIMessageEvent) => {
    if (!msg.data) return;
    const event = parseMidiMessage(msg.data);
    if (event) onEvent(event);
  };
  const bind = () => {
    for (const input of access.inputs.values()) input.onmidimessage = handler;
  };
  bind();
  access.onstatechange = bind;
  const names = [...access.inputs.values()].map((i) => i.name ?? "MIDI input");
  return {
    message: names.length ? `Listening to ${names.join(", ")}. ${KEYBOARD_HINT}` : `No MIDI keyboard found. ${KEYBOARD_HINT}`,
    close() {
      access.onstatechange = null;
      for (const input of access.inputs.values()) input.onmidimessage = null;
    },
  };
}
