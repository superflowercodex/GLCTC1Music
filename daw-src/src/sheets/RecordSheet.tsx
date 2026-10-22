import { useEffect, useRef, useState } from "react";
import { RecordingError, startRecording, type RecordSource, type RecordingSession } from "../audio/recorder";
import { showToast } from "../audio/media";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { Seg, Switch } from "../ui/controls";
import { useRaf } from "../ui/hooks";
import { Meter } from "../ui/Meter";
import { Sheet } from "./Sheet";

type SourceKind = RecordSource["kind"];
type Phase = "idle" | "starting" | "counting" | "recording";

const SOURCES: ReadonlyArray<{ value: SourceKind; label: string }> = [
  { value: "mic", label: "Mic" },
  { value: "track", label: "Track" },
  { value: "instrument", label: "Instrument" },
  { value: "master", label: "Master" },
];

const HELP: Record<SourceKind, string> = {
  mic: "Records from your microphone or audio interface.",
  track: "Records what one track plays, after its effects.",
  instrument: "Records one instrument’s output, such as Galactic One.",
  master: "Records everything you hear, after the master limiter.",
};

const COUNT_IN = [
  { value: 0, label: "Off" },
  { value: 1, label: "1 bar" },
  { value: 2, label: "2 bars" },
] as const;

const STOP_AFTER: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Never" },
  { value: 4, label: "4 bars" },
  { value: 8, label: "8 bars" },
  { value: 16, label: "16 bars" },
];

interface InputDevice {
  id: string;
  label: string;
}

async function listInputs(): Promise<InputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  let unnamed = 0;
  return all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications").map((d) => ({ id: d.deviceId, label: d.label || `Input ${++unnamed}` }));
}

export function RecordSheet({ onClose }: { onClose: () => void }) {
  const tracks = useStore(projectStore, (p) => p.tracks);
  const instruments = useStore(projectStore, (p) => p.instruments);
  const [kind, setKind] = useState<SourceKind>("mic");
  const [trackId, setTrackId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [inputs, setInputs] = useState<InputDevice[]>([]);
  const [countIn, setCountIn] = useState<0 | 1 | 2>(1);
  const [stopAfter, setStopAfter] = useState(0);
  const [stems, setStems] = useState(false);
  const [punchIn, setPunchIn] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const session = useRef<RecordingSession | null>(null);

  useEffect(() => {
    void listInputs().then(setInputs, () => setInputs([]));
  }, []);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The recorder can end a take by itself (stop-after bars); the sheet follows it.
  useRaf(() => {
    const s = session.current;
    if (!s) return;
    const state = s.state;
    if (state === "stopped") {
      session.current = null;
      setPhase("idle");
      closeRef.current();
      return;
    }
    setPhase((prev) => (prev === state ? prev : state));
  });

  // Closing the sheet while a take is running keeps the take: stopping is what turns it into a clip.
  useEffect(
    () => () => {
      const s = session.current;
      if (s && s.state !== "stopped") void s.stop().catch((err: unknown) => showToast(err instanceof Error ? err.message : "The recording could not be saved."));
    },
    [],
  );

  const effectiveTrack = trackId || tracks.find((t) => t.kind !== "video")?.id || "";
  const effectiveSlot = slotId || instruments[0]?.id || "";
  const trackName = (id: string): string => tracks.find((t) => t.id === id)?.name ?? id;

  const source = (): RecordSource | null => {
    switch (kind) {
      case "mic":
        return deviceId ? { kind, deviceId } : { kind };
      case "master":
        return { kind };
      case "track":
        return effectiveTrack ? { kind, trackId: effectiveTrack } : null;
      case "instrument":
        return effectiveSlot ? { kind, slotId: effectiveSlot } : null;
    }
  };

  const noSource = (kind === "track" && !effectiveTrack) || (kind === "instrument" && !effectiveSlot);

  const start = async (): Promise<void> => {
    const chosen = source();
    if (!chosen) return;
    setError(null);
    setPhase("starting");
    try {
      session.current = await startRecording({ source: chosen, countInBars: countIn, stopAfterBars: stopAfter === 0 ? null : stopAfter, stems, punchIn });
      setPhase(session.current.state === "stopped" ? "idle" : session.current.state === "counting" ? "counting" : "recording");
    } catch (err) {
      session.current = null;
      setPhase("idle");
      setError(err instanceof RecordingError || err instanceof Error ? err.message : "Recording could not start.");
    }
  };

  const stop = async (): Promise<void> => {
    const s = session.current;
    if (!s) return;
    try {
      await s.stop();
      session.current = null;
      setPhase("idle");
      onClose();
    } catch (err) {
      session.current = null;
      setPhase("idle");
      setError(err instanceof Error ? err.message : "The recording could not be saved.");
    }
  };

  const busy = phase !== "idle";
  const level = (): number => session.current?.level() ?? 0;

  return (
    <Sheet title="Record" subtitle="Takes become clips on a new track" onClose={busy ? () => void stop() : onClose}>
      <div>
        <div className="field-label">What to record</div>
        <Seg className="wide" label="What to record" options={SOURCES} value={kind} onChange={(v) => !busy && setKind(v)} />
        <div className="field-help">{HELP[kind]}</div>
        {kind === "mic" && (
          <label className="device-pick" style={{ display: "block", marginTop: 12 }}>
            <span className="sr-only">Microphone</span>
            <select value={deviceId} disabled={busy} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Default input</option>
              {inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "track" && (
          <label style={{ display: "block", marginTop: 12 }}>
            <span className="sr-only">Track to record</span>
            <select value={effectiveTrack} disabled={busy || tracks.length === 0} onChange={(e) => setTrackId(e.target.value)}>
              {tracks.length === 0 && <option value="">No tracks yet</option>}
              {tracks
                .filter((t) => t.kind !== "video")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind === "instrument" && (
          <label style={{ display: "block", marginTop: 12 }}>
            <span className="sr-only">Instrument to record</span>
            <select value={effectiveSlot} disabled={busy || instruments.length === 0} onChange={(e) => setSlotId(e.target.value)}>
              {instruments.length === 0 && <option value="">No instruments yet. Open one in Play first.</option>}
              {instruments.map((s) => (
                <option key={s.id} value={s.id}>
                  {trackName(s.trackId)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "18px 26px" }}>
        <div>
          <div className="field-label">Count in</div>
          <div className="chip-row" role="radiogroup" aria-label="Count in">
            {COUNT_IN.map((c) => (
              <button key={c.value} type="button" role="radio" aria-checked={countIn === c.value} disabled={busy} className={`chip ${countIn === c.value ? "on" : ""}`} onClick={() => setCountIn(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="field-label">Stop after</div>
          <div className="chip-row" role="radiogroup" aria-label="Stop after">
            {STOP_AFTER.map((c) => (
              <button key={c.value} type="button" role="radio" aria-checked={stopAfter === c.value} disabled={busy} className={`chip ${stopAfter === c.value ? "on" : ""}`} onClick={() => setStopAfter(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <Switch label="Separate stems" checked={stems} onChange={(v) => !busy && setStems(v)} />
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <Switch label="Punch in" checked={punchIn} onChange={(v) => !busy && setPunchIn(v)} />
        </div>
      </div>
      {punchIn && <div className="field-help" style={{ marginTop: -8 }}>Punch in records only inside the loop region, with a bar of lead-in so you hear what you are joining.</div>}

      <div className="rec-status">
        <span>Level</span>
        <Meter horizontal getLevel={level} />
      </div>
      {phase !== "idle" && (
        <div className="rec-state" role="status">
          {phase === "starting" ? "Opening the input…" : phase === "counting" ? "Counting in…" : "Recording. Press Stop when you are done."}
        </div>
      )}
      {error && (
        <p className="sheet-alert" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        {phase === "idle" || phase === "starting" ? (
          <button type="button" data-autofocus className="btn btn-hero btn-record" disabled={phase === "starting" || noSource} onClick={() => void start()}>
            <span className="dot" />
            Start recording
          </button>
        ) : (
          <button type="button" data-autofocus className="btn btn-hero btn-record" onClick={() => void stop()}>
            <span className="dot" />
            Stop
          </button>
        )}
        {!busy && (
          <button type="button" className="btn btn-ghost" style={{ height: 60 }} onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </Sheet>
  );
}
