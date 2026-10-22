export interface PeakIndex {
  block: number;
  min: Float32Array;
  max: Float32Array;
}

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

const BLOCK = 256;

/** Per-block min and max across all channels, so a zoomed-out redraw reads thousands of values rather than millions. */
export function buildPeakIndex(buffer: AudioBuffer, block = BLOCK): PeakIndex {
  const blocks = Math.ceil(buffer.length / block);
  const min = new Float32Array(blocks);
  const max = new Float32Array(blocks);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < blocks; b++) {
      let lo = c === 0 ? Infinity : min[b];
      let hi = c === 0 ? -Infinity : max[b];
      const end = Math.min(data.length, (b + 1) * block);
      for (let i = b * block; i < end; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
  }
  return { block, min, max };
}

/** Min and max for `bins` equal slices of [startSample, endSample); samples outside the file count as silence. */
export function peaksForRange(index: PeakIndex, buffer: AudioBuffer, startSample: number, endSample: number, bins: number): Peaks {
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  const span = endSample - startSample;
  if (bins <= 0 || span <= 0) return { min, max };
  const per = span / bins;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (let b = 0; b < bins; b++) {
    const rawFrom = Math.floor(startSample + b * per);
    const rawTo = Math.max(rawFrom + 1, Math.floor(startSample + (b + 1) * per));
    if (rawTo <= 0 || rawFrom >= buffer.length) continue;
    const from = Math.max(0, rawFrom);
    const to = Math.min(buffer.length, rawTo);
    let lo = Infinity;
    let hi = -Infinity;
    if (per >= index.block * 2) {
      const bFrom = Math.ceil(from / index.block);
      const bTo = Math.floor(to / index.block);
      for (let k = bFrom; k < bTo; k++) {
        if (index.min[k] < lo) lo = index.min[k];
        if (index.max[k] > hi) hi = index.max[k];
      }
    } else {
      for (const data of channels) {
        for (let i = from; i < to; i++) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (lo <= hi) {
      min[b] = lo;
      max[b] = hi;
    }
  }
  return { min, max };
}
