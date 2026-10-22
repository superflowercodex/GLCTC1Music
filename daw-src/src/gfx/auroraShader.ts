export const AURORA_VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Deep-space nebula: four slow light pools (in the project's colours, walking through its palette family over
// minutes) plus one pool in the room accent, shaped by a domain-warped cloud and cut by darker dust lanes. Each
// room adds its own layer (Arrange aurora ribbons, Mixer meter shafts, Song clouds, Stage deep focus, Library dust
// band, an instrument's bloom behind the device), occasional weather drifts through, and the music swells, warms
// and blooms it. Output is premultiplied (rgb <= a) over the black void and soft-capped at uCap, because frosted
// glass and text sit on top of it.
export const AURORA_FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uOctaves;
uniform vec3 uAccent;
uniform vec2 uFocus;
uniform vec3 uPoolA;
uniform vec3 uPoolB;
uniform vec3 uPoolC;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec3 uP3;
uniform vec4 uEnergy;
uniform vec3 uTint;
uniform float uKick;
uniform float uMeter;
uniform vec3 uScene;
uniform vec3 uScene2;
uniform vec3 uWeather;
uniform vec4 uWeatherGeo;
uniform vec3 uWeatherCol;
uniform vec4 uSection;
uniform float uCap;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    // The frame governor drops the last octave when frames run long.
    if (float(i) >= uOctaves) break;
    v += a * noise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}
float pool(vec2 p, vec2 c, vec2 r) {
  vec2 d = (p - c) / r;
  return exp(-dot(d, d));
}
// An aurora curtain: a sharp lower hem that fades upward, broken into fine vertical rays.
float ribbon(vec2 p, float y0, float sway, float t, float seed) {
  float yc = y0 + sway * sin(p.x * 1.15 + t * 2.3 + seed) + 0.03 * sin(p.x * 2.7 - t * 1.6);
  float d = p.y - yc;
  float hem = d < 0.0 ? exp(-d * d / 0.0018) : exp(-d / 0.13);
  float rays = 0.45 + 0.55 * noise(vec2(p.x * 9.0 + seed * 7.0, t * 1.2));
  return hem * rays;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
  float t = uTime * 0.018;
  float ribbonsW = uScene.x;
  float shaftsW = uScene.y;
  float cloudsW = uScene.z;
  float deepW = uScene2.x;
  float dustW = uScene2.y;
  float deviceW = uScene2.z;
  float gain = uEnergy.x;
  float wide = uEnergy.y;
  float sparse = uEnergy.z;
  float swell = uEnergy.w;

  vec2 q = vec2(fbm(p * 1.25 + vec2(t, -t * 0.6)), fbm(p * 1.25 + vec2(4.1 - t * 0.7, 1.7 + t)));
  float cloud = fbm(p * 1.7 + 1.7 * q + vec2(t * 0.5, 0.0));
  // Song's clouds have firmer edges; the resting body is the soft wash the other rooms share.
  float body = mix(0.18 + 1.05 * smoothstep(0.32, 0.86, cloud), 0.14 + 1.4 * smoothstep(0.36, 0.8, cloud), cloudsW * 0.75);
  body *= 1.0 - 0.35 * sparse * (1.0 - smoothstep(0.45, 0.7, cloud));
  float dust = smoothstep(0.52, 0.78, fbm(p * 2.6 - q * 1.3 + 9.0));

  vec3 violet = vec3(0.66, 0.40, 1.0);
  vec3 magenta = vec3(1.0, 0.388, 0.847);
  vec3 cyan = vec3(0.475, 0.922, 1.0);
  vec3 gold = vec3(1.0, 0.79, 0.36);

  float w = 0.5 * asp;
  vec2 f = vec2((uFocus.x - 0.5) * asp, uFocus.y - 0.5);
  // The pools carry the project's colours as they walk its palette; a touch of the brand hue keeps every palette cosmic.
  vec3 poolB = mix(violet, uPoolB, 0.88);
  vec3 poolA = mix(mix(magenta, uPoolA, 0.92), uSection.rgb, uSection.a * cloudsW);
  vec3 poolC = mix(cyan, uPoolC, 0.85);
  vec3 col = vec3(0.0);
  col += poolB * 0.5 * pool(p, vec2(-0.55 * w + uP0.x * w + 0.10 * sin(t * 2.9), 0.30 + uP0.y + 0.06 * cos(t * 2.1)), vec2(0.62 * w, 0.48) * uP0.z);
  col += poolA * 0.42 * pool(p, vec2(0.62 * w + uP1.x * w + 0.08 * cos(t * 2.4), 0.36 + uP1.y + 0.05 * sin(t * 3.3)), vec2(0.5 * w, 0.40) * uP1.z);
  col += poolC * 0.22 * pool(p, vec2(0.18 * w + uP2.x * w + 0.12 * sin(t * 1.7), -0.50 + uP2.y * 0.5 + 0.04 * cos(t * 2.6)), vec2(0.8 * w, 0.34) * uP2.z);
  // Warm sections feed the small gold pool.
  col += gold * 0.16 * (1.0 + 0.8 * max(0.0, uTint.r - uTint.b)) * pool(p, vec2(-0.78 * w + uP3.x * w + 0.05 * cos(t * 3.1), -0.40 + uP3.y * 0.5), vec2(0.34 * w, 0.28) * uP3.z);

  // Weather: a cloud of a new colour drifting through.
  vec2 wc = vec2((uWeatherGeo.x - 0.5) * asp, uWeatherGeo.y - 0.5);
  col += uWeatherCol * 0.34 * uWeather.x * pool(p, wc, vec2(0.42 * w, 0.34)) * (0.35 + 0.9 * cloud);

  // Stage sinks the surrounding sky so its focal glow reads as the one light source.
  col *= 1.0 - 0.3 * deepW;

  // The room's pool: wider on a drop, tighter and brighter on the Stage.
  vec2 fr = vec2(0.62 * w, 0.52) * (1.0 + 0.35 * wide) * mix(1.0, 0.62, deepW);
  col += uAccent * 0.42 * (1.0 + 0.55 * deepW) * pool(p, f + vec2(0.06 * sin(t * 2.2), 0.05 * cos(t * 1.9)), fr);
  // An instrument glows from behind the device as well as above it.
  col += uAccent * 0.34 * deviceW * pool(p, vec2(0.0, -0.02), vec2(0.72 * w, 0.4));

  col *= body * (1.0 - (0.46 + 0.3 * sparse) * dust) * 0.68;
  // The Stage's focal glow shines through the cloud instead of being shaped by it.
  col += uAccent * 0.12 * deepW * pool(p, f, vec2(0.3 * w, 0.26) * (1.0 + 0.3 * wide));

  // Arrange: wide horizontal aurora ribbons, coloured along their length.
  if (ribbonsW > 0.01) {
    vec3 rc = mix(poolC, uAccent, smoothstep(-0.6, 0.6, p.x / w));
    float r = ribbon(p, 0.18, 0.06, t, 0.0) + 0.6 * ribbon(p, -0.16, 0.045, t * 0.8, 2.1);
    col += rc * 0.2 * ribbonsW * r * (0.55 + 0.6 * cloud);
  }
  // Mixer: vertical shafts rising from the floor, as tall as the master is loud.
  if (shaftsW > 0.01) {
    float cols = smoothstep(0.35, 0.95, noise(vec2(p.x * 6.5, t * 0.9)));
    float rise = exp(-(p.y + 0.5) / (0.26 + 0.5 * uMeter));
    vec3 sc = mix(uAccent, poolB, noise(vec2(p.x * 2.0, 3.0)));
    col += sc * 0.3 * shaftsW * cols * rise * (0.6 + 0.7 * uMeter);
  }
  // Weather shafts: soft slanted beams falling from the top.
  if (uWeather.y > 0.01) {
    float a = uWeatherGeo.z;
    float xr = p.x * cos(a) + p.y * sin(a);
    float beams = pow(noise(vec2(xr * 4.5, t * 0.5 + 5.0)), 3.0) * smoothstep(-0.45, 0.5, p.y);
    col += mix(vec3(0.92, 0.94, 1.0), poolA, 0.55) * 0.16 * uWeather.y * beams;
  }
  // A drifting dust band (weather, and always a calm one in the Library): faint light, broken by dark lanes.
  float bandW = max(uWeather.z, 0.75 * dustW);
  if (bandW > 0.01) {
    float a = mix(uWeatherGeo.z, 0.32, dustW);
    vec2 n = vec2(-sin(a), cos(a));
    float d = dot(p, n) - mix(uWeatherGeo.w, 0.06 + 0.08 * sin(t * 1.3), dustW);
    float band = exp(-d * d / 0.022);
    col += mix(poolB, vec3(0.86, 0.84, 1.0), 0.35) * 0.1 * bandW * band * (0.4 + cloud);
    col *= 1.0 - 0.45 * bandW * band * dust;
  }

  // A kick breathes light out from the room's focus.
  col += uAccent * 0.14 * uKick * pool(p, f, vec2(0.46 * w, 0.4) * (1.0 + 0.3 * uKick + 0.4 * wide));

  col *= uTint * gain * (1.0 + 0.16 * swell);

  // Soft shoulder up to the cap, scaled on the brightest channel so the hue holds instead of washing to white.
  float m = max(col.r, max(col.g, col.b));
  float knee = 0.72 * uCap;
  float mm = m <= knee ? m : knee + (uCap - knee) * (1.0 - exp(-(m - knee) / (uCap - knee)));
  col *= mm / max(m, 1e-4);
  // Dither one LSB so the low-resolution, upscaled gradients never band.
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  col = clamp(col, 0.0, uCap);
  float alpha = max(col.r, max(col.g, col.b));
  gl_FragColor = vec4(col, alpha);
}
`;

/** Decides which animation frames to draw and drops to a cheaper mode when the browser cannot keep up. */
export class FramePacer {
  private last = Number.NEGATIVE_INFINITY;
  private slow = 0;
  private fps: number;
  downgraded = false;

  constructor(targetFps = 45, private readonly lowFps = 30) {
    this.fps = targetFps;
  }

  get interval(): number {
    return 1000 / this.fps;
  }

  /** Changes the rate (busy vs idle); once downgraded it never climbs back above the low rate. */
  set target(fps: number) {
    this.fps = this.downgraded ? Math.min(fps, this.lowFps) : fps;
  }

  /** True when this animation frame should be drawn. */
  shouldRender(now: number): boolean {
    const dt = now - this.last;
    // A few ms of slack so a 60 Hz display is not forced down to 30 by rounding.
    if (dt < this.interval - 3) return false;
    this.last = now;
    if (dt > this.interval * 1.6 && dt < 500) this.slow += 1;
    else this.slow = Math.max(0, this.slow - 1);
    if (this.slow >= 30 && !this.downgraded) {
      this.downgraded = true;
      this.fps = Math.min(this.fps, this.lowFps);
      this.slow = 0;
    }
    return true;
  }
}

export class ColorParseError extends Error {}

/** "#rgb" or "#rrggbb" to linear-ish 0..1 floats (the shader works in display space). */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new ColorParseError(`Not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Frame-rate independent ease toward a target: after `tau` seconds about 63% of the gap is closed. */
export function approach(current: number, target: number, dtSeconds: number, tau: number): number {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-Math.max(0, dtSeconds) / tau);
}
