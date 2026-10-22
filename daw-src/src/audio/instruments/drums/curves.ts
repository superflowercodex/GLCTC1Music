const satCache = new Map<string, Float32Array<ArrayBuffer>>();

export function satCurve(k: number): Float32Array<ArrayBuffer> {
  const key = k.toFixed(2);
  const hit = satCache.get(key);
  if (hit) return hit;
  const n = 1025;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(k * ((i * 2) / (n - 1) - 1)) / norm;
  satCache.set(key, curve);
  return curve;
}

/** Soft overdrive for the 80LA8 channel strip; zero drive is a straight line. */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = amount * 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = amount < 0.001 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** Quantises the signal to fewer levels; 0 is clean, 1 is about 2 bits. */
export function crushCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const steps = Math.max(2, Math.round(2 + amount * 126));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = amount < 0.01 ? x : (Math.round(((x + 1) / 2) * (steps - 1)) / (steps - 1)) * 2 - 1;
  }
  return curve;
}

/** Linear below the knee, then rolls off to just under full scale, so nothing past the output can exceed 1.0. */
export function limiterCurve(knee = 0.8): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}
