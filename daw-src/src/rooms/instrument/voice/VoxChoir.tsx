import type { Vox } from "../../../audio/instruments/vox";
import { PianoStrip } from "./PianoStrip";
import { ParamControl } from "./ParamControl";

const VOICES = [
  ["voiceSoprano", "Soprano"],
  ["voiceAlto", "Alto"],
  ["voiceTenor", "Tenor"],
  ["voiceBass", "Bass"],
] as const;

export function VoxChoir({ vox }: { vox: Vox }) {
  const syllable = vox.nextSyllable();
  return (
    <div className="voice-surface">
      <div>
        <label className="hw-title" htmlFor="choir-lyrics" style={{ marginBottom: 10 }}>
          Lyrics the choir sings
        </label>
        <textarea id="choir-lyrics" className="lyrics-box" rows={3} value={vox.lyrics} spellCheck={false} onChange={(e) => vox.setLyrics(e.target.value)} />
      </div>
      <div>
        <div className="hw-title" style={{ marginBottom: 10 }}>
          Voices
        </div>
        <div className="hw-keys" role="group" aria-label="Voices">
          {VOICES.map(([id, name]) => {
            const on = vox.getParam(id) === 1;
            return (
              <button key={id} type="button" aria-pressed={on} className={`hw-key led ${on ? "on" : ""}`} onClick={() => vox.setParam(id, on ? 0 : 1)}>
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="choir-grid knob-grid">
        <ParamControl instrument={vox} id="choirVowel" label="Vowel · Ah to Oo" />
        <ParamControl instrument={vox} id="choirVibrato" />
        <ParamControl instrument={vox} id="choirBreath" />
        <ParamControl instrument={vox} id="choirSpread" />
      </div>
      <div className="hw-note">
        {vox.getParam("choirLyrics") === 1
          ? `Play the keys and the choir sings your words, one syllable per note.${syllable ? ` Next: “${syllable}”.` : ""}`
          : "Words are off, so every note sings the vowel on the slider. Switch Words to Lyrics on the right to sing your text."}
      </div>
      <div style={{ marginTop: "auto" }}>
        <PianoStrip
          onNoteOn={(note, velocity) => vox.noteOn({ note, velocity }, 2)}
          onNoteOff={(note) => vox.noteOff(note)}
        />
      </div>
    </div>
  );
}
