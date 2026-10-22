import { useRef, useState } from "react";
import { midiRouter, midiService, type MidiBinding } from "../../audio/midi";
import { PluginError, pluginHost } from "../../audio/pluginHost";
import { useStore } from "../../store/store";
import { confirmSheet } from "../../sheets/confirm";
import { toast } from "./media";

function errorText(error: unknown): string {
  return error instanceof PluginError || error instanceof Error ? error.message : String(error);
}

function PluginsPanel() {
  const { plugins, saveError } = useStore(pluginHost.store, (s) => s);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setAddress("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-label="Plugins">
      <h2>Plugins</h2>
      <p>Instruments and effects that run in the browser (Web Audio Modules). Native VST and AU files cannot run here.</p>
      <div className="lib-field">
        <input
          aria-label="Plugin address"
          placeholder="Paste a plugin address (https://...)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void run(() => pluginHost.addFromUrl(address));
          }}
        />
        <button type="button" className="lib-pill primary" disabled={busy || !address.trim()} onClick={() => void run(() => pluginHost.addFromUrl(address))}>
          {busy ? "Loading..." : "Add"}
        </button>
        <button type="button" className="lib-pill" disabled={busy} onClick={() => file.current?.click()}>From file</button>
        <input
          ref={file}
          type="file"
          accept=".js,.mjs,.vst,.vst3,.component,.dll,.au"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run(() => pluginHost.addFromFile(f));
          }}
        />
      </div>
      <div className="lib-warn">A plugin is code from the address you give. Only add ones you trust.</div>
      {error && <div className="lib-error" role="alert">{error}</div>}
      {saveError && <div className="lib-error" role="alert">{saveError}</div>}
      <div className="lib-list">
        {plugins.length === 0 && <div className="lib-empty">No plugins yet.</div>}
        {plugins.map((p) => (
          <div key={p.id} className="lib-item">
            <span className="grow" title={p.url}>{p.name}</span>
            <span className="meta">{p.sessionOnly ? "This session only" : p.role === "instrument" ? "Instrument" : "Effect"}</span>
            <span className="dot" aria-label="Loads correctly" />
            <button type="button" className="lib-pill small" aria-label={`Remove ${p.name}`} onClick={() => pluginHost.remove(p.id)}>Remove</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function controlText(b: MidiBinding): string {
  return `${b.kind === "cc" ? "CC" : "Note"} ${b.number}${b.channel ? ` · ch ${b.channel + 1}` : ""}`;
}

function BindingRow({ b, available }: { b: MidiBinding; available: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(b.name);
  const done = (): void => {
    setEditing(false);
    try {
      if (draft.trim() !== b.name) midiRouter.bindings.rename(b.id, draft);
    } catch (e) {
      toast(errorText(e));
      setDraft(b.name);
    }
  };
  return (
    <div className={`lib-item ${available ? "" : "dim"}`}>
      {editing ? (
        <input
          className="lib-rename"
          aria-label="Link name"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={done}
          onKeyDown={(e) => {
            if (e.key === "Enter") done();
            if (e.key === "Escape") {
              setDraft(b.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="lib-name-btn grow" style={{ font: "600 16px var(--body)" }} title="Click to rename" onClick={() => { setDraft(b.name); setEditing(true); }}>
          {b.name}
        </button>
      )}
      {!available && <span className="meta">not on screen</span>}
      <span className="meta">{controlText(b)}</span>
      <button type="button" className="lib-pill small danger" aria-label={`Clear link ${b.name}`} onClick={() => midiRouter.bindings.clear(b.id)}>Clear</button>
    </div>
  );
}

function MidiPanel() {
  const state = useStore(midiService.state, (s) => s);
  const { bindings, saveError } = useStore(midiRouter.bindings.store, (s) => s);
  const targets = useStore(midiRouter.targets, (t) => t);
  const learning = useStore(midiRouter.learn, (s) => s.targetId);
  const [picked, setPicked] = useState("");
  const chosen = targets.some((t) => t.id === picked) ? picked : (targets[0]?.id ?? "");

  const pill =
    state.status === "unsupported" ? (
      <span className="lib-pillstate">Not supported in this browser</span>
    ) : state.status === "ready" ? (
      <span className="lib-pillstate ok">{state.devices.length ? `${state.devices.length} device${state.devices.length === 1 ? "" : "s"} connected` : "No devices connected"}</span>
    ) : state.status === "requesting" ? (
      <span className="lib-pillstate">Waiting for permission...</span>
    ) : (
      <button type="button" className="lib-pill small primary" onClick={() => void midiService.enable()}>Enable MIDI</button>
    );

  return (
    <section className="panel" aria-label="MIDI">
      <div className="lib-head">
        <h2>MIDI</h2>
        {pill}
      </div>
      {state.status === "unsupported" && <div className="lib-warn">Web MIDI works in Chrome, Edge and Opera. This browser does not support it, so keyboards and controllers cannot connect.</div>}
      {state.error && <div className="lib-error" role="alert">{state.error}</div>}
      {state.status === "ready" && state.devices.length > 0 && <div className="lib-sub">{state.devices.map((d) => d.name).join(" · ")}</div>}
      <div className="lib-head">
        <div className="lib-sub">Controls you've linked</div>
        {bindings.length > 1 && (
          <button
            type="button"
            className="lib-pill small danger"
            onClick={() =>
              void confirmSheet({
                title: "Clear every MIDI link?",
                message: `This removes all ${bindings.length} links. You can link controls again any time.`,
                confirmLabel: "Clear all",
                cancelLabel: "Keep them",
                danger: true,
                }).then((ok) => ok && midiRouter.bindings.clearAll())
            }
          >
            Clear all
          </button>
        )}
      </div>
      {saveError && <div className="lib-error" role="alert">{saveError}</div>}
      <div className="lib-list">
        {bindings.length === 0 && <div className="lib-empty">Nothing linked yet.</div>}
        {bindings.map((b) => (
          <BindingRow key={b.id} b={b} available={targets.some((t) => t.id === b.targetId)} />
        ))}
      </div>
      <div className="lib-field">
        <select className="lib-select" aria-label="Control to link" value={chosen} disabled={learning !== null} onChange={(e) => setPicked(e.target.value)}>
          {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button
          type="button"
          className="lib-pill primary"
          disabled={!chosen || learning !== null || state.status !== "ready"}
          title={state.status === "ready" ? "Then move a knob or press a key on your controller" : "Enable MIDI first"}
          onClick={() => {
            try {
              midiRouter.startLearn(chosen);
            } catch (e) {
              toast(errorText(e));
            }
          }}
        >
          Link
        </button>
      </div>
    </section>
  );
}

export function PluginsTab() {
  return (
    <div className="lib-plug">
      <PluginsPanel />
      <MidiPanel />
    </div>
  );
}
