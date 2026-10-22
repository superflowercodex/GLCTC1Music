export const GALAXY_VERTEX = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uPx;
varying vec3 vColor;
varying float vAlpha;

const vec3 AMBER = vec3(1.0, 0.827, 0.416);
const vec3 PINK = vec3(1.0, 0.388, 0.847);
const vec3 VIOLET = vec3(0.557, 0.486, 1.0);
const vec3 CYAN = vec3(0.475, 0.922, 1.0);

void main() {
  float r = pow(aSeed.x, 0.62) * 3.0 + 0.12;
  float arm = floor(aSeed.y * 3.0) * 2.0943951;
  float spread = (fract(aSeed.y * 3.0) - 0.5) * 0.9 / (0.6 + r * 0.5);
  float ang = arm + r * 1.35 + spread + uTime * 0.08 / (0.5 + r * 0.6);
  float pulse = 1.0 + uBass * 0.22 * sin(r * 3.0 - uTime * 2.0);
  float lift = (aSeed.z - 0.5) * 0.4 / (0.7 + r * 0.4) + sin(ang * 2.0 + uTime) * 0.05 * uMid;
  vec3 p = vec3(cos(ang) * r * pulse, lift, sin(ang) * r * pulse);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.6 + aSeed.z * 2.4 + uBass * 2.5) * uPx * (4.0 / -mv.z);

  float t = clamp(r / 3.0, 0.0, 1.0);
  vec3 c = mix(AMBER, PINK, smoothstep(0.0, 0.3, t));
  c = mix(c, VIOLET, smoothstep(0.3, 0.65, t));
  c = mix(c, CYAN, smoothstep(0.65, 1.0, t));
  vColor = c * (0.85 + uBass * 0.5);
  vAlpha = 0.35 + 0.65 * (1.0 - t * 0.6);
}
`;

export const GALAXY_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

export interface AudioBands {
  bass: number;
  mid: number;
  high: number;
}

/** Averages an analyser's byte spectrum into three 0 to 1 bands (roughly below 260 Hz, to 2 kHz, above). */
export function bandsFromSpectrum(spectrum: Uint8Array): AudioBands {
  const avg = (from: number, to: number) => {
    const end = Math.min(to, spectrum.length);
    if (end <= from) return 0;
    let sum = 0;
    for (let i = from; i < end; i++) sum += spectrum[i];
    return sum / (end - from) / 255;
  };
  return { bass: avg(1, 7), mid: avg(7, 47), high: avg(47, 200) };
}

/** Quick attack and slow fall so the visuals punch on a kick without flickering. */
export function smoothBand(previous: number, target: number): number {
  return target > previous ? previous + (target - previous) * 0.6 : previous + (target - previous) * 0.12;
}
