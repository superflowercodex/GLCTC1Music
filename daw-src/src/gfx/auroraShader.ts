export const AURORA_VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Domain-warped value noise tinted in the brand palette. Output is premultiplied and kept faint so UI text on top stays legible.
export const AURORA_FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform float uKick;

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
    v += a * noise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.035;

  vec2 q = vec2(fbm(p * 1.4 + vec2(t, 0.0)), fbm(p * 1.4 + vec2(5.2, -t)));
  float f = fbm(p * 1.6 + 2.2 * q + vec2(0.0, t));

  vec3 cyan = vec3(0.475, 0.922, 1.0);
  vec3 violet = vec3(0.557, 0.486, 1.0);
  vec3 pink = vec3(1.0, 0.388, 0.847);
  vec3 amber = vec3(1.0, 0.827, 0.416);

  vec3 col = mix(violet, cyan, smoothstep(0.25, 0.75, q.x));
  col = mix(col, pink, smoothstep(0.45, 0.95, q.y) * 0.8);
  col = mix(col, amber, smoothstep(0.78, 1.0, f) * 0.5);

  float ribbon = smoothstep(0.35, 0.8, f) * (0.35 + 0.65 * smoothstep(1.1, 0.0, length(p * vec2(0.8, 1.2))));
  float strength = 0.16 + 0.07 * uLevel + 0.09 * uKick;
  float a = clamp(ribbon * strength * 2.0, 0.0, 0.34);
  gl_FragColor = vec4(col * a, a);
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
      this.fps = this.lowFps;
      this.slow = 0;
    }
    return true;
  }
}
