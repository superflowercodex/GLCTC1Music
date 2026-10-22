import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { outputSupport } from "../../audio/master";
import { showToast } from "../../audio/media";
import { updateTrack } from "../../project/actions";
import type { Track } from "../../project/model";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
import { Button, Slider } from "../../ui/controls";
import { listOutputDevices, unlockDeviceNames, type AudioDevice } from "./devices";
import { setMaster } from "./edit";

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)}>
      <span className={`switch ${on ? "on" : ""}`}>
        <span className="knob" />
      </span>
    </button>
  );
}

function DevicePicker({ label, value, devices, disabled, onChange }: { label: string; value: string; devices: AudioDevice[]; disabled: boolean; onChange: (id: string) => void }) {
  const known = value === "default" || devices.some((d) => d.id === value);
  return (
    <label className="device-pick">
      <span className="sr-only">{label} device</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="default">System default</option>
        {!known && <option value={value}>Unavailable device</option>}
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function OutputsTab() {
  const master = useStore(projectStore, (p) => p.master);
  const tracks = useStore(projectStore, (p) => p.tracks);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const support = outputSupport();

  const refresh = useCallback(async () => {
    try {
      setDevices(await listOutputDevices());
      setProblem(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not list audio devices.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    media?.addEventListener?.("devicechange", refresh);
    return () => media?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  const find = async (): Promise<void> => {
    try {
      await unlockDeviceNames();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not unlock device names.");
    }
    await refresh();
  };

  const edit = (id: string, patch: Partial<Pick<Track, "toMaster" | "cue">>): void => projectStore.set((p) => updateTrack(p, id, patch));
  const unsupported = !support.booth && !support.headphones;

  return (
    <div className="outputs-tab scroll-y">
      <div className="device-cards">
        <section className="device-card" aria-label="Headphones">
          <h3>Headphones</h3>
          <DevicePicker label="Headphones" value={master.headphoneDeviceId} devices={devices} disabled={!support.headphones} onChange={(id) => projectStore.set((p) => setMaster(p, { headphoneDeviceId: id }))} />
          <Slider label="Volume" value={master.headphoneVolume} min={0} max={1} step={0.01} onChange={(v) => projectStore.set((p) => setMaster(p, { headphoneVolume: v }))} format={(v) => `${Math.round(v * 100)}%`} />
          <p className="mixer-note">Plays whatever you switch Cue on for, so you can listen without the audience hearing it.</p>
          {!support.headphones && <p className="mixer-warn">This browser cannot send the cue mix to a chosen device. It will play on the system output.</p>}
        </section>
        <section className="device-card" aria-label="Booth">
          <h3>Booth</h3>
          <DevicePicker label="Booth" value={master.boothDeviceId} devices={devices} disabled={!support.booth} onChange={(id) => projectStore.set((p) => setMaster(p, { boothDeviceId: id }))} />
          <Slider label="Volume" value={master.boothVolume} min={0} max={1} step={0.01} onChange={(v) => projectStore.set((p) => setMaster(p, { boothVolume: v }))} format={(v) => `${Math.round(v * 100)}%`} />
          <Button onClick={() => void find()}>Find my devices</Button>
          {!support.booth && <p className="mixer-warn">This browser cannot choose the main output device (Safari and Firefox do not support it yet). Sound plays on the system output.</p>}
        </section>
      </div>
      {unsupported && <p className="mixer-note">Device choice needs a Chromium browser such as Chrome, Edge or Opera. Cue and send-to-master still work.</p>}
      {problem && (
        <p className="mixer-warn" role="status">
          {problem}
        </p>
      )}
      <div className="route-head">
        <span>Track</span>
        <span>Send to master</span>
        <span>Cue in headphones</span>
      </div>
      {tracks.length === 0 && <p className="mixer-empty">No tracks yet.</p>}
      {tracks.map((t) => (
        <div key={t.id} className="route-row" style={{ "--c": t.color } as CSSProperties}>
          <div className="fx-track">
            <span className="strip-dot" />
            <span className="fx-track-name">{t.name}</span>
          </div>
          <Toggle on={t.toMaster} label={`Send ${t.name} to master`} onChange={(on) => edit(t.id, { toMaster: on })} />
          <Toggle on={t.cue} label={`Cue ${t.name} in the headphones`} onChange={(on) => edit(t.id, { cue: on })} />
        </div>
      ))}
    </div>
  );
}
