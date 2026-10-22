export type WavBitDepth = 16 | 24;

export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavError";
  }
}

export interface WavOptions {
  bitDepth: WavBitDepth;
  /** Triangular dither before rounding to 16 bits, which hides quantisation noise in quiet passages. Ignored at 24 bits. */
  dither?: boolean;
}

export interface DecodedWav {
  sampleRate: number;
  bitDepth: WavBitDepth;
  channels: Float32Array[];
}

const HEADER_BYTES = 44;
// The RIFF size field is 32 bits; longer audio would silently wrap and produce a file players cannot open.
const MAX_DATA_BYTES = 0xffffffff - 36;

function sampleToInt(x: number, scale: number, negScale: number): number {
  const v = Math.min(1, Math.max(-1, Number.isFinite(x) ? x : 0));
  return Math.round(v < 0 ? v * negScale : v * scale);
}

/** Deterministic noise so exporting the same project twice gives the same bytes. */
function ditherSource(): () => number {
  let a = 0x2545f491;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => next() - next();
}

/** Interleaved PCM WAV. All channels must have the same length. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number, options: WavOptions): ArrayBuffer {
  if (channels.length === 0) throw new WavError("There is no audio to write.");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new WavError(`Invalid sample rate ${sampleRate}.`);
  const frames = channels[0].length;
  if (channels.some((c) => c.length !== frames)) throw new WavError("All channels must be the same length.");
  const bytesPerSample = options.bitDepth / 8;
  const dataBytes = frames * channels.length * bytesPerSample;
  if (dataBytes > MAX_DATA_BYTES) throw new WavError("This is too long for a WAV file (over 4 GB). Export a shorter range or the tracks separately.");

  const out = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(out);
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * bytesPerSample, true);
  view.setUint16(32, channels.length * bytesPerSample, true);
  view.setUint16(34, options.bitDepth, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);

  const dither = options.dither && options.bitDepth === 16 ? ditherSource() : null;
  let offset = HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      if (options.bitDepth === 16) {
        const x = dither ? channel[i] + dither() / 32768 : channel[i];
        view.setInt16(offset, sampleToInt(x, 0x7fff, 0x8000), true);
      } else {
        const s = sampleToInt(channel[i], 0x7fffff, 0x800000);
        view.setUint8(offset, s & 0xff);
        view.setUint8(offset + 1, (s >> 8) & 0xff);
        view.setUint8(offset + 2, (s >> 16) & 0xff);
      }
      offset += bytesPerSample;
    }
  }
  return out;
}

export function audioBufferToWav(buffer: AudioBuffer, options: WavOptions): ArrayBuffer {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return encodeWav(channels, buffer.sampleRate, options);
}

/** Reads back what encodeWav writes; also used to validate a file before trusting it. */
export function decodeWav(data: ArrayBuffer): DecodedWav {
  if (data.byteLength < HEADER_BYTES) throw new WavError("That file is too short to be a WAV.");
  const view = new DataView(data);
  const tag = (o: number): string => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt ") throw new WavError("That file is not a WAV.");
  if (view.getUint16(20, true) !== 1) throw new WavError("Only PCM WAV files are supported.");
  const channelCount = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  if (bits !== 16 && bits !== 24) throw new WavError(`Unsupported bit depth ${bits}.`);
  if (tag(36) !== "data") throw new WavError("The WAV header is missing its data chunk.");
  const dataBytes = view.getUint32(40, true);
  const bytesPerSample = bits / 8;
  if (channelCount < 1 || HEADER_BYTES + dataBytes > data.byteLength) throw new WavError("The WAV header does not match its contents.");
  const frames = Math.floor(dataBytes / (bytesPerSample * channelCount));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  let offset = HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      let s: number;
      if (bits === 16) s = view.getInt16(offset, true);
      else {
        s = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
        if (s & 0x800000) s -= 0x1000000;
      }
      const full = bits === 16 ? 0x8000 : 0x800000;
      channel[i] = s < 0 ? s / full : s / (full - 1);
      offset += bytesPerSample;
    }
  }
  return { sampleRate, bitDepth: bits, channels };
}

export function wavFileSizeBytes(frames: number, channels: number, bitDepth: WavBitDepth): number {
  return HEADER_BYTES + frames * channels * (bitDepth / 8);
}
