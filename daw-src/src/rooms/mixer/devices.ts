import { OutputRoutingError } from "../../audio/master";

export interface AudioDevice {
  id: string;
  label: string;
}

/** Output devices the browser exposes. Labels are blank until the user has granted microphone access once. */
export async function listOutputDevices(): Promise<AudioDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    throw new OutputRoutingError("This browser cannot list audio devices.");
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  let unnamed = 0;
  return all
    .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d) => ({ id: d.deviceId, label: d.label || `Output ${++unnamed}` }));
}

/** Browsers hide device names until a page has asked for the microphone; this asks once and lets go straight away. */
export async function unlockDeviceNames(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new OutputRoutingError("This browser cannot ask for device access.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    throw new OutputRoutingError("Microphone access was blocked, so device names cannot be shown. The devices are still listed by number.");
  }
}
