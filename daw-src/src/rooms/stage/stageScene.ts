import type * as ThreeNS from "three";
import type { Clip, Project } from "../../project/model";
import { frameAspect as projectFrameAspect, isActiveAt, mediaTime, planeSize, stageOptions } from "./stageModel";
import { bandsFromSpectrum, GALAXY_FRAGMENT, GALAXY_VERTEX, smoothBand, type AudioBands } from "./visuals";

type Three = typeof ThreeNS;

export interface StageHost {
  project(): Project;
  /** Project time in seconds. */
  timeSec(): number;
  playing(): boolean;
  /** Fills the array with the master spectrum; false when no audio engine exists yet. */
  spectrum(out: Uint8Array<ArrayBuffer>): boolean;
  loadBlob(assetId: string): Promise<Blob | undefined>;
  onError(message: string): void;
}

export interface StageQuality {
  reducedMotion: boolean;
  /** Small screens get fewer particles and a pixel ratio of 1. */
  small: boolean;
}

interface Layer {
  clip: Clip;
  mesh: ThreeNS.Mesh;
  material: ThreeNS.MeshBasicMaterial;
  texture?: ThreeNS.Texture;
  video?: HTMLVideoElement;
  url?: string;
  bitmap?: ImageBitmap;
  aspect: number;
  ready: boolean;
  disposed: boolean;
  playFailed: boolean;
}

const RING_SEGMENTS = 192;
const NAVY = 0x070b1c;

/**
 * The Stage's Three.js scene: an audio-reactive galaxy behind, and video and picture clips composited
 * as opacity-blended planes in front. It owns every GPU resource it creates and frees them in dispose().
 */
export class StageScene {
  private readonly renderer: ThreeNS.WebGLRenderer;
  private readonly visScene: ThreeNS.Scene;
  private readonly visCamera: ThreeNS.PerspectiveCamera;
  private readonly mediaScene: ThreeNS.Scene;
  private readonly mediaCamera: ThreeNS.OrthographicCamera;
  private readonly galaxy: ThreeNS.Group;
  private readonly galaxyMaterial: ThreeNS.ShaderMaterial;
  private readonly ringPositions: Float32Array;
  private readonly ringGeometry: ThreeNS.BufferGeometry;
  private readonly ringMaterials: ThreeNS.LineBasicMaterial[];
  private readonly planeGeometry: ThreeNS.PlaneGeometry;
  private readonly layers = new Map<string, Layer>();
  private readonly spectrum = new Uint8Array(512);
  private readonly bands: AudioBands = { bass: 0, mid: 0, high: 0 };
  private readonly resizeObserver: ResizeObserver;
  private readonly disposables: Array<{ dispose(): void }> = [];

  private visuals = true;
  private raf = 0;
  private running = false;
  private dirty = true;
  private lastTime = Number.NaN;
  private lastFrameMs = 0;
  private slowFrames = 0;
  private width = 1;
  private height = 1;
  private pixelRatio: number;
  private readonly onVisibility = () => {
    if (document.hidden) this.pauseVideos();
    else this.invalidate();
  };

  constructor(
    private readonly three: Three,
    readonly canvas: HTMLCanvasElement,
    private readonly host: StageHost,
    private readonly quality: StageQuality,
  ) {
    const T = three;
    this.pixelRatio = quality.small ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new T.WebGLRenderer({ canvas, antialias: !quality.small, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(NAVY, 1);
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(this.pixelRatio);

    this.visScene = new T.Scene();
    this.visCamera = new T.PerspectiveCamera(48, 16 / 9, 0.1, 60);
    this.mediaScene = new T.Scene();
    this.mediaCamera = new T.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -10, 10);

    const count = quality.small ? 2500 : 7000;
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const galaxyGeometry = new T.BufferGeometry();
    galaxyGeometry.setAttribute("aSeed", new T.BufferAttribute(seeds, 3));
    // The vertex shader places every point itself, so the position attribute only needs the right count.
    galaxyGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array(count * 3), 3));
    this.galaxyMaterial = new T.ShaderMaterial({
      vertexShader: GALAXY_VERTEX,
      fragmentShader: GALAXY_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uPx: { value: this.pixelRatio } },
    });
    const points = new T.Points(galaxyGeometry, this.galaxyMaterial);
    points.frustumCulled = false;

    const segments = quality.small ? 96 : RING_SEGMENTS;
    this.ringPositions = new Float32Array(segments * 3);
    this.ringGeometry = new T.BufferGeometry();
    this.ringGeometry.setAttribute("position", new T.BufferAttribute(this.ringPositions, 3));
    this.ringMaterials = [0x79ebff, 0xff63d8].map((color) => new T.LineBasicMaterial({ color, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false }));
    const ring = new T.LineLoop(this.ringGeometry, this.ringMaterials[0]);
    const ringOuter = new T.LineLoop(this.ringGeometry, this.ringMaterials[1]);
    ringOuter.scale.setScalar(1.18);
    ring.frustumCulled = false;
    ringOuter.frustumCulled = false;

    this.galaxy = new T.Group();
    this.galaxy.add(points, ring, ringOuter);
    this.galaxy.rotation.x = -0.32;
    this.visScene.add(this.galaxy);

    this.planeGeometry = new T.PlaneGeometry(1, 1);
    this.disposables.push(galaxyGeometry, this.galaxyMaterial, this.ringGeometry, ...this.ringMaterials, this.planeGeometry, this.renderer);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  setVisuals(on: boolean): void {
    this.visuals = on;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Brings the media layers in line with the project's stage clips; call whenever those clips change. */
  setClips(clips: readonly Clip[]): void {
    for (const [id, layer] of this.layers) {
      const next = clips.find((c) => c.id === id);
      if (!next || next.assetId !== layer.clip.assetId) {
        this.disposeLayer(layer);
        this.layers.delete(id);
      }
    }
    for (const clip of clips) {
      const layer = this.layers.get(clip.id);
      if (layer) layer.clip = clip;
      else this.addLayer(clip);
    }
    this.invalidate();
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const layer of this.layers.values()) this.disposeLayer(layer);
    this.layers.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    // Browsers cap live WebGL contexts, so give this one back immediately instead of waiting for garbage collection.
    this.renderer.forceContextLoss();
  }

  private addLayer(clip: Clip): void {
    const T = this.three;
    const material = new T.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    const mesh = new T.Mesh(this.planeGeometry, material);
    mesh.visible = false;
    mesh.renderOrder = this.layers.size;
    this.mediaScene.add(mesh);
    const layer: Layer = { clip, mesh, material, aspect: 16 / 9, ready: false, disposed: false, playFailed: false };
    this.layers.set(clip.id, layer);
    void this.loadMedia(layer).catch((e: unknown) => this.host.onError(`Could not load "${clip.name}": ${e instanceof Error ? e.message : String(e)}`));
  }

  private async loadMedia(layer: Layer): Promise<void> {
    const T = this.three;
    const { clip } = layer;
    if (!clip.assetId) throw new Error("the clip has no media file.");
    const blob = await this.host.loadBlob(clip.assetId);
    if (layer.disposed) return;
    if (!blob) throw new Error("the file is missing from this browser's storage.");

    if (clip.kind === "image") {
      const bitmap = await createImageBitmap(blob);
      if (layer.disposed) {
        bitmap.close();
        return;
      }
      layer.bitmap = bitmap;
      const texture = new T.Texture(bitmap);
      texture.colorSpace = T.SRGBColorSpace;
      texture.needsUpdate = true;
      layer.texture = texture;
      layer.aspect = bitmap.width / Math.max(1, bitmap.height);
    } else {
      const url = URL.createObjectURL(blob);
      layer.url = url;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
      layer.video = video;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("the browser cannot play this video format."));
      });
      if (layer.disposed) return;
      const texture = new T.VideoTexture(video);
      texture.colorSpace = T.SRGBColorSpace;
      layer.texture = texture;
      layer.aspect = video.videoWidth / Math.max(1, video.videoHeight);
    }
    layer.material.map = layer.texture ?? null;
    layer.material.needsUpdate = true;
    layer.ready = true;
    this.invalidate();
  }

  private disposeLayer(layer: Layer): void {
    layer.disposed = true;
    this.mediaScene.remove(layer.mesh);
    layer.material.dispose();
    layer.texture?.dispose();
    layer.bitmap?.close();
    if (layer.video) {
      layer.video.pause();
      layer.video.removeAttribute("src");
      layer.video.load();
    }
    if (layer.url) URL.revokeObjectURL(layer.url);
  }

  private pauseVideos(): void {
    for (const l of this.layers.values()) if (l.video && !l.video.paused) l.video.pause();
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, Math.round(parent.clientWidth));
    const h = Math.max(1, Math.round(parent.clientHeight));
    if (w === this.width && h === this.height && this.renderer.getPixelRatio() === this.pixelRatio) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.visCamera.aspect = aspect;
    this.visCamera.position.set(0, 1.8, 5.2 * Math.max(1, 1 / (aspect * 1.1)));
    this.visCamera.lookAt(0, 0, 0);
    this.visCamera.updateProjectionMatrix();
    this.mediaCamera.left = -aspect / 2;
    this.mediaCamera.right = aspect / 2;
    this.mediaCamera.updateProjectionMatrix();
    this.galaxyMaterial.uniforms.uPx.value = this.pixelRatio * (h / 540);
    this.invalidate();
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;

    const project = this.host.project();
    const t = this.host.timeSec();
    const playing = this.host.playing();
    const moved = t !== this.lastTime;
    this.lastTime = t;

    this.syncVideos(project, t, playing);
    const animate = !this.quality.reducedMotion;
    if (!animate && !this.dirty && !moved && !playing) return;
    this.dirty = false;

    if (this.lastFrameMs > 0) this.trackPerformance(now - this.lastFrameMs);
    this.lastFrameMs = now;

    this.updateVisuals(now / 1000, animate);
    this.updateMediaPlanes(project, t);

    const r = this.renderer;
    r.clear();
    if (this.visuals) r.render(this.visScene, this.visCamera);
    r.clearDepth();
    r.render(this.mediaScene, this.mediaCamera);
  };

  private trackPerformance(dt: number): void {
    // Sustained long frames mean the GPU is struggling; dropping to a pixel ratio of 1 is the cheapest fix.
    this.slowFrames = dt > 28 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 45 && this.pixelRatio > 1) {
      this.pixelRatio = 1;
      this.slowFrames = 0;
      this.resize();
    }
  }

  private updateVisuals(seconds: number, animate: boolean): void {
    if (!this.visuals) return;
    const fresh = animate && this.host.spectrum(this.spectrum);
    const target = fresh ? bandsFromSpectrum(this.spectrum) : { bass: animate ? 0.08 + 0.04 * Math.sin(seconds) : 0, mid: 0.05, high: 0.03 };
    this.bands.bass = smoothBand(this.bands.bass, target.bass);
    this.bands.mid = smoothBand(this.bands.mid, target.mid);
    this.bands.high = smoothBand(this.bands.high, target.high);

    const u = this.galaxyMaterial.uniforms;
    u.uTime.value = animate ? seconds : 4;
    u.uBass.value = this.bands.bass;
    u.uMid.value = this.bands.mid;
    this.galaxy.rotation.y = animate ? seconds * 0.03 : 0.6;

    const n = this.ringPositions.length / 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // Mirror the spectrum around the ring so both halves match.
      const mirrored = i < n / 2 ? i / (n / 2) : 2 - i / (n / 2);
      const level = fresh ? this.spectrum[Math.floor(mirrored * 90) + 2] / 255 : 0.1;
      const radius = 1.25 + level * 0.65 * (0.6 + this.bands.bass);
      this.ringPositions[i * 3] = Math.cos(a) * radius;
      this.ringPositions[i * 3 + 1] = 0;
      this.ringPositions[i * 3 + 2] = Math.sin(a) * radius;
    }
    this.ringGeometry.attributes.position.needsUpdate = true;
  }

  private updateMediaPlanes(project: Project, t: number): void {
    const frame = this.width / this.height || projectFrameAspect(project.stageAspect);
    for (const layer of this.layers.values()) {
      const active = layer.ready && isActiveAt(layer.clip, t, project.bpm, project.beatsPerBar);
      layer.mesh.visible = active;
      if (!active) continue;
      const o = stageOptions(layer.clip);
      const size = planeSize(o.fit, layer.aspect, frame);
      layer.mesh.scale.set(size.w, size.h, 1);
      layer.material.opacity = o.opacity;
      if (layer.video && layer.video.readyState >= 2 && layer.texture) layer.texture.needsUpdate = true;
    }
  }

  private syncVideos(project: Project, t: number, playing: boolean): void {
    for (const layer of this.layers.values()) {
      const video = layer.video;
      if (!video || !layer.ready) continue;
      const active = isActiveAt(layer.clip, t, project.bpm, project.beatsPerBar);
      if (!active) {
        if (!video.paused) video.pause();
        continue;
      }
      const speed = stageOptions(layer.clip).speed;
      const target = mediaTime(layer.clip, t, project.bpm, project.beatsPerBar, Number.isFinite(video.duration) ? video.duration : undefined);
      if (video.playbackRate !== speed) video.playbackRate = speed;
      if (playing) {
        if (!video.seeking && Math.abs(video.currentTime - target) > 0.3) video.currentTime = target;
        if (video.paused && !layer.playFailed) {
          video.play().catch((e: unknown) => {
            layer.playFailed = true;
            this.host.onError(`The browser would not play "${layer.clip.name}": ${e instanceof Error ? e.message : String(e)}`);
          });
        }
      } else {
        if (!video.paused) video.pause();
        if (!video.seeking && Math.abs(video.currentTime - target) > 0.04) video.currentTime = target;
      }
    }
  }
}
