# daw.html core JS audit (lines 766-1500)

Scope: preamble guards (766-796), project model, master clock, audio engine, timeline/clip editing, import, recording, export, undo/redo, MIDI + MIDI learn, automation, sample analysis/warp, plugins/WAM, loop markers, master mixer, Looper, 80LA8 drum lab, transport hub, and the start of DIVINE09/90MINE (slice ends mid-voice-engine at line 1500; the rest of that module is outside this slice). HTML element ids are as referenced by JS; labels/markup live outside this slice.

No injected instructions were found in the file content.

---

## 1. Persistence and data formats

| Store | Key / name | Contents |
|---|---|---|
| IndexedDB | DB `glctc1-sequencer-local` v1, store `projects`, keyPath `id` | Full project object. `dbProject()` strips `audioBuffer`, `decoding`, `peaking`. Asset `blob` is stored natively (no base64). `peaks` Float32Array is kept. |
| IndexedDB | DB `glctc1_divine09_samples` v1, store `samples`, key "0".."3" | `{name, bytes}` for the four DIVINE09 sample slots. Not part of the project or the package. |
| localStorage | `glctc1.midiBindings` | `{elementId: {kind:'cc'\|'note', number, channel}}` |
| localStorage | `glctc1.wams` | `[{name,url}]` saved Web Audio Module plugins |
| localStorage | `glctc1.modulesOn` | `'1'`/`'0'` for the MODULES ON/OFF button |
| localStorage | `glctc1_90mine_state` | DIVINE09/90MINE settings and patterns (module state, not in project) |
| sessionStorage | `glctc1.fresh` | Set by the REFRESH button |
| Package file | `<safeName>.glctc1` (JSON) | `{...project, assets:[{id,name,type,mime,size,duration,bpm,key,analyzed,data:<dataURL base64>}]}`. `version:1`. On import `data` is turned back into a Blob. |
| WAV export | `<safeName>.wav` | 44.1 kHz, stereo, 16-bit PCM, no dither |

Project object fields: `version, id, name, bpm, timeSig, master, tracks[], assets[], created, updated`, plus lazily-created `mfx{on,flt,dly,rev}`, `loop{on,start,end}`, `stage('wide'|'phone')`, `mixer{hpVol,boothVol,hpDev,boothDev,hpMix}`, `beatLab{...}` (80LA8, including base64 samples).

Track fields: `id, name, type('audio'|'midi'|'video'|'auto'), color, volume, pan, mute, solo, clips[]`, optional `fx{on,flt,dly,rev,cut,ds,rs}`, `plugs[]`, `inst`, `wamInst`, `send`, `cue`, `looper{sel,pads[16]}`.

Clip fields: `id, name, kind('audio'|'video'|'image'|'midi'|'auto'), start, length` (all in beats), `assetId, offset, gain, fadeIn, fadeOut, rate, pitch, fine, warp, keyLock`, `notes[{pitch,beat,length,velocity}]` (MIDI), `target/tracks/points[{beat,v}]` (automation).

Default project (14 tracks): Drums, Bass (MIDI, with an empty 4-bar "Bass Pattern" clip), Percussion, Synth Lead (MIDI), Vocals, FX, Video, Video FX, "Looper · Module Track", and one "Module Track" each for 80LA8, 90MINE, 30LEE, 0010110 and GALACTIC ONE. Defaults: 130 BPM, 4/4, master 0.8. On init a demo song is loaded (`lpLoadDemo`) and a toast announces it after 600 ms.

Save paths
- Save is `#saveProject` / `#saveProjectFooter` / Cmd or Ctrl+S. It writes to IndexedDB and shows the toast "Project saved on this device." Status becomes "Saved locally".
- Open from the saved list is `#savedProjects` rows (an "Open" button each) or `#loadProject`. `#loadProject` uses a native `prompt()` with a numbered list.
- Package export is `#exportProject` / `#exportProjectBottom`. Package import is `#openProject` -> `#projectFile`.
- There is no autosave.

---

## 2. Feature inventory (user capability -> trigger -> detail)

### 2.1 Transport and clock
- **Play/Pause**: `#playBtn` (glyph toggles ▶ / Ⅱ), Space bar. Play also stops the Song Composer if it is running.
- **Stop**: `#stopBtn` (pauses and resets to 0). `#toStart` does the same. Stop also sends a "stop" event to modules.
- **Seek**: click the ruler (`#rulerGrid`) or any empty area of a lane (`#trackRows` click). Seeking is snapped to the grid when Snap is on. Clicking in the editor waveform (without dragging) seeks to that position in the clip. Seeking while playing re-anchors audio to the next 16th of the master grid.
- **Position readouts**: `#clock` shows mm:ss:ms. `#position` shows bar:beat:tick (960 ticks per beat).
- **Master BPM**: `#bpm` accepts 30-300. Live input applies immediately (invalid values are ignored until blur/change, then clamped). Changing tempo during playback is sample-accurate. It appends a tempo segment 0.16 s ahead, re-anchors the timeline, and re-times all tempo-synced delays. On change it also re-prepares stretched clips, re-times the looper and updates module tempo displays.
- **Time signature**: `#timeSig` (4/4 default). It changes bar length, ruler numbering, loop defaults and clip length fields (clip start and length are shown in bars).
- **Metronome**: `#metronome` checkbox (off by default; forced off at init). Accent is 1200 Hz on beat 1, 800 Hz otherwise. It plays straight to the destination, so it bypasses master FX, the mixer and export.
- **Loop region**: `#loopBtn` toggles it. The green and orange ruler markers are dragged to move start/end, snapped to the grid, with a minimum length of 0.25 beat. It is persisted in `project.loop`. When the playhead hits the loop end, all sources are stopped and rescheduled from the loop start (an audible tail cut is possible).
- **Auto-stop**: playback stops at `totalBeats()`, which is the longest clip end + 4 bars, with a minimum of 32 bars.
- **Master transport -> modules**: starting or stopping the timeline broadcasts to registered modules (see 2.12). If the Song Composer slaves the timeline, it uses `window.glctcTimeline.{startAt,halt,realign,slave,playing,beat}`.
- **Zoom (timeline)**: `#zoomIn` / `#zoomOut` step 4 px per beat, range 10-64 (default 22). There is no wheel or pinch zoom in this slice.
- **Snap and grid**: `#snap` checkbox and `#grid` select (step in beats). They apply to clip drag/resize, lane double-click, seek, loop markers, trim handles, editor selection and MIDI record quantize.

### 2.2 Tracks
- **Add track**: `#addAudioTrack`, `#addAudioTrack2`, `#addVideoTrack`, `#addVideoTrack2`, `#addImageTrack` (makes a Video track), `#addSynth` / `#addMidi` (MIDI track + 4-bar clip + opens the piano roll), `#addInstTrack`, `#lpCreate` (new Looper track), `#addAuto` (FX automation track). New tracks get the next palette colour (8-colour cycle), volume 0.8.
- **Per-row buttons**: index number, name (double-click or ✎ to rename via native `prompt()`), M mute, S solo, FX (per-track FX on/off; not shown on automation tracks), ● record (MIDI or audio tracks only), × delete (native `confirm('Delete track and its clips?')`).
- **Select track**: click the label. Selection drives the Track Mixer box, plugin panel and where "＋ add asset" lands.
- **Track mixer box** (`#trackMixerBox`): volume (0-1), pan (-1..1, step 0.1), and the Track FX strip.
- **Mute/Solo logic**: any solo silences non-solo tracks. Automation tracks obey mute only. Mute/solo triggers a rebase so it takes effect live.
- **Clear arrangement**: `#clearProject`, with `confirm()`. It removes clips only; tracks and assets stay.
- There is **no track reorder, no colour picker, no track duplicate and no track height control** in this slice.

### 2.3 Clips and the timeline
- **Create**: `＋` on each asset row. It picks the selected track if the type matches, else the first matching track, else creates a track. It places the clip at the playhead (rounded to a beat). Length is the asset duration (min 1 bar) or 2 bars for images. Double-clicking an empty lane makes a 4-bar clip at the click position (snapped), which is an empty "Audio Clip" with no asset on audio tracks. On automation tracks it creates an automation object.
- **Select**: click a clip. The Object Editor, sample panel, piano roll, video/image stage and trim bar update.
- **Move**: drag the clip body (threshold 3 px). Vertical drag moves it to another track of the same kind (valid lanes highlight with the `.drop` class). It shows a translateY preview and updates the Start/Length fields live.
- **Resize**: left and right handles, shown only when the clip is at least 28 px wide. The left handle on audio shifts the offset (trims the head). On MIDI it shifts the notes. Minimum length is 0.25 beat. The right handle is capped at the source duration, so a clip cannot be stretched past the asset length (no clip looping).
- **Numeric edit**: `#clipName`, `#clipStart` (bars, 1-based), `#clipLength` (bars).
- **Buttons**: `#deleteClip` / `#objDel` / Delete or Backspace key, `#duplicateClip` (places the copy right after the original), `#splitClip` (at the playhead; needs the playhead at least 0.05 beat inside, otherwise toast), `#trimStart` (cut the head up to the playhead), `#fadeIn` / `#fadeOut` (toggle a 1-beat fade), `#clipGain` (per-clip gain).
- **Clipboard**: `#objCopy` / `#objCut` / `#objPaste`, Cmd or Ctrl+C / X / V. Paste goes to the playhead on the selected track, or the first track of a matching kind.
- **Editor waveform** (`#waveCanvas`): drag to select a range (shown in `#edSel`, readout in `#edInfo`). `#cutOut` removes the range and splits the clip into two. `#keepSel` keeps only the range. Tap to place the cursor (seeks). Gold squares at the top corners are dragged to set fade-in/out (the hit zone is the top 26 px, plus or minus 20 px of the handle). Zoom with `#edZoomIn`, `#edZoomOut`, `#edFit` (1x-16x). Fade ramps are drawn on the waveform.
- **Trim bar** (`#trimWrap`, handles `#trimL` / `#trimR`): shows the whole source waveform with dimmed regions. Dragging the handles non-destructively trims the head or tail, with snap, and keeps fades bounded. Info line: "Only the part between the gold handles plays".
- **Clip art**: audio waveforms (cached peaks), MIDI note mini-rolls, automation curves, image thumbnails tiled, video clips with a gradient background. Waveforms are placeholders (a pseudo-random wave) until the audio has decoded.
- **Piano roll** (`#pianoPanel`, `#openPiano`, `#pianoTrack` picker): fixed 16 columns per clip length and 37 rows (C3 to C6). Click a cell to toggle a note. Note length is one column, velocity is fixed at 0.75, and clicking a new cell auditions it. It cannot drag, resize or change velocity.
- **Image/Video stage**: `#videoPreview`, `[data-stage]` buttons (wide or phone, saved in the project), `#stageFull` (fullscreen), `#previewPlay`. During playback the selected video clip is played muted and kept in sync (seek if drift exceeds 0.5 s). Image clips show on the stage while the playhead is inside them.

### 2.4 Import / assets
- **Import buttons**: `#importAudio` (`#audioFiles`, multi), `#importVideo` (`#videoFiles`), `#importImage` (`#imageFiles`; non-images give the toast "Please choose image files (PNG, JPG, GIF, WebP, SVG)").
- Files are decoded for duration and waveform. Video assets are decoded for audio peaks. If the video has no audio track, `noAudio` is set and the sample panel hides.
- **Asset browser**: tabs `[data-tab]` (audio, midi, video, image, project, plugins), `#assetSearch` filter, per-row tag "bpm · key" (or "analysing…"). There is no asset delete, no rename and no drag-and-drop to the timeline in this slice. Adding is only via ＋.
- **Project file**: `#projectFile` accepts `.glctc1`. It is validated for `tracks[]` and `assets[]`, and if invalid the toast says "Project could not be opened: ...".

### 2.5 Audio recording
- **Audio**: the track ● button or `#recordBtn` with an audio track (or non-MIDI track) selected. Uses `getUserMedia({audio:true})` + `MediaRecorder` (browser default codec). Starts timeline playback, which means the mic hears the speakers. Press ● again to stop. The take becomes an asset named "Recording <time>" and is placed at the playhead where recording started on the armed track (falls back to the first audio track or creates one). Playback is paused when recording stops.
- **MIDI**: the ● on a MIDI track, or `#recordBtn` with a MIDI track selected. This makes a 4-bar clip at the playhead and starts playback. Input is the computer keyboard (A W S E D F T G Y H U J K O L, which is C4 to D5; fixed velocity 0.8) or Web MIDI note messages. Notes are quantized to the grid if Snap is on, and note length has a minimum of the grid step. The clip grows in whole bars as needed and trims to the last note on stop. Toast: "MIDI recorded."
- **Mic permission failure** shows the toast "Microphone access was blocked." Unsupported shows "Recording is not supported in this browser." There is no input device chooser, no count-in, no input monitoring and no latency compensation.

### 2.6 Undo / redo
- `#undoBtn` / `#edUndo`, `#redoBtn` / `#edRedo`, Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y. Buttons disable when the stack is empty.
- Snapshot-based (JSON of the project excluding `assets`), max 80 steps, with changes within 600 ms coalesced into one step (so slider drags and drags are one undo).
- Loading a different project resets history. Undo pauses playback. Undo restores asset references from the current project, so imports are not undone (the asset list is not in history).
- 80LA8 state, including base64 samples, is inside the snapshot (see perf notes).

### 2.7 Sample analysis, pitch, warp, key lock (clever/non-obvious)
- **BPM detection** (`detectBpm`): decimates to 11 kHz mono (first 240 s), log-energy onset envelope, autocorrelation, a log-Gaussian prior centred on 120 BPM (sigma 1.2 octaves), and parabolic peak interpolation. Result is folded into 62-190. For samples of 40 s or less it snaps to a whole number of beats (2, 4, 6 ... 64) if within 3%. It runs automatically after decode (30 ms timeout, on the main thread) and shows the toast "<name>: 120 BPM · Am detected" or "no clear tempo or key found".
- **Key detection** (`detectKey`): 8192-point FFT over up to 40 frames, 70-1800 Hz, chroma, Krumhansl-Schmuckler major/minor profiles. Minimum correlation 0.6. Confidence below 0.72 shows "(?)".
- **Sample panel** (`#sampleRow`, shown for audio/video clips with decodable audio): `#detBpm`, `#detKey`, `#useBpm` (set master BPM from the sample), `#bpmHalf` / `#bpmDouble` (fix wrong octave; rescales warped clip lengths), `#clipWarp` ("Sync tempo", audio only, time-stretch factor clamped 0.5-2.0 relative to master BPM), `#clipKeyLock` (keep pitch while tempo syncs), `#clipPitch` (semitones) and `#clipFine` (cents) with `#pitchVal` / `#fineVal` readouts, `#pitchReset`, and `#pitchInfo` (e.g. "Playing in Dm (+2.00 st) · tempo 120 -> 130 BPM · key locked").
- **Time-stretch/pitch** (`stretchBuffer`): WSOLA-style overlap-add with correlation search, processed in a `setTimeout` (toast "Processing pitch / tempo..."), cached by asset and ratio (cap about 300 MB, eviction of old entries). Until the cache is ready, playback falls back to plain playback-rate (pitch shifts with tempo). Export computes stretches synchronously. Video clips get pitch only (no warp).

### 2.8 Mixing, FX and routing
- **Master**: `#masterVol` (0-1, saved in the project), `#filterCutoff`, `#delayMix`, `#reverbMix` (displayed as % / `#filterValue` etc.), master FX switches `#mfxOn` (shows "FX ON/OFF") plus `[data-mfx]` buttons flt/dly/rev (saved in `project.mfx`). Slider *values* for cutoff/delay/reverb are not saved in the project (see bugs).
- **Signal chain**: master gain -> compressor ("limiter" with threshold 0, ratio 1, effectively a no-op) -> master filter -> master delay and reverb sends -> soft-clip saturator (tanh knee at 0.8) -> speakers. Delay time is tempo-synced to a dotted 8th (0.75 beat), capped at 1.4 s, and re-synced on tempo change.
- **Track FX strip** (`fxStrip`, in the Track Mixer and the mixer strip): FX master switch, FLT / DLY / REV switches, Cutoff 200-18000 Hz, Delay send, Reverb send (shared send buses).
- **Insert FX** (plugin panel `#plugDyn` and the mixer strip's "INSERT FX · ALL OPEN"): Drive, Chorus, Compressor, 3-Band EQ, Low-pass, High-pass, Delay, Reverb. All exist on every track in a fixed order, default OFF. Each has an ON/OFF toggle and live parameter sliders (not reorderable, not removable).
- **MIDI instruments** (per MIDI track, `<select>` in the plugin panel): Basic synth (saw) or presets Saw Lead, Super Saw, Sub Bass, Square Pluck, Warm Pad, Organ, FM Bell, Electric Keys (ADSR, filter, detune, sub, FM). 13 test-note buttons (C4-C5). A WAM instrument can be added as "🔌 name".
- **WAM plugins** (`#loadPlugin` -> `#plugFile` for `.js`/`.mjs`, `#wamUrl` + Enter for a URL, optional `#wamSdk` host-SDK URL; defaults to jsdelivr then unpkg). `.vst`/`.au` etc. show the toast ".x is a native plugin and cannot run in a browser. Load its Web Audio Module (.js or URL) version instead." Loaded plugins are remembered by URL in `glctc1.wams` and shown in `#wamSaved` (Load / ×). An in-page editor overlay (`#wamOv`) opens with a Close button. Instruments need a MIDI track; effects are appended to the chain. After reload an instrument shows "⟳ Reload plugin".
- **Master mixer view** (`#mixStrips`): per track, a volume fader, pan, MUTE, SOLO, "→MST" (send to master on/off), "HP" (headphone cue send), a peak meter with dB text, and a latching CLIP lamp (click to reset). Master L/R meters `#mtL` / `#mtR`, `#mDb`, `#mClip`.
- **Output routing**: `#hpDev` (Not routed / Main output / any audio output device) and `#boothDev` (Not routed / devices) via `setSinkId` on hidden audio elements. `#hpVol`, `#boothVol`, `#hpMix` (also send the master mix to headphones). `#outDetect` asks for mic permission to unlock device labels, then lists devices. Saved device ids persist in `project.mixer`. Errors: "Could not route to that device." / "This browser cannot choose output devices." (Safari).

### 2.9 Automation
- **FX automation tracks** (type 'auto', purple): `#addAuto` with `#autoTarget` select adds a track and an automation object. Targets: Master Volume / Filter / Delay / Reverb, Track Volume / Filter cutoff / Delay send / Reverb send.
- `#addAutoObj` adds more objects to an automation track. A lane double-click does the same.
- **Editing** (selected object): `#autoTarget2` changes the target, `#autoLinks` checkboxes choose which tracks are affected ("ALL tracks" or specific ones; master targets show "controls the master output"). Freehand drawing on the object editor canvas (draw replaces the points in the swept span). `#autoShape` presets: flat, up, down, triangle, sine, saw, with cycles equal to the object's length in bars.
- The curve is applied at 1/16-beat linear ramps in both live and offline renders. Filter is mapped exponentially 200-18000 Hz. Volume range is 0-1 (master) or 0-1.5 (track).
- Stop resets all automated params to their base values.

### 2.10 MIDI and hardware
- `#plugMidi` enables Web MIDI (Chrome/Edge/Opera only; shows "Web MIDI needs Chrome, Edge or Opera (not Safari/iOS)."). `#plugMidiSt` lists connected inputs and refreshes on hot-plug.
- Live play: a MIDI keyboard plays the selected MIDI track (or the first MIDI track) with its instrument or WAM. CC 123 is all-notes-off.
- **MIDI Learn** (`#midiLearnBtn`, toggle "🎹 MIDI LEARN ON/OFF"): while on, clicking any button/input/select/slider is intercepted (not activated) and armed. Then move a CC or press a note and it is bound. CC maps to range/number (scaled to min-max with step), checkbox (>=0.5), select (index) and button (rising edge). A note on triggers a button click, toggles a checkbox or sets a range to the max. Bindings are keyed by element id and channel, saved in `glctc1.midiBindings`, and shown with `.midi-learning` styling. The toast says "Assignments are saved on this device." Controls without an id are given dynamic ids `midiLearnControlN`.
- **Pad MIDI**: notes 36-51 trigger looper pads 1-16 when a looper track is selected (and it is not a MIDI track).

### 2.11 Export
- **WAV**: `#exportAudio`. Offline render at 44.1 kHz stereo with master gain, master filter/delay/reverb (when on), per-track volume/pan/FX/inserts (not WAM), warp/pitch (computed synchronously), fades, automation and MIDI notes through the preset instruments. Skips muted and non-soloed tracks, image clips and automation tracks. `confirm('This project is over 10 minutes long. Rendering may use significant memory. Continue?')` appears above 600 s. Toasts: "Rendering audio mix. Please keep this tab open." then "WAV mix exported." On failure: "WAV export failed. Try a shorter project or fewer tracks."
- **Package**: `#exportProject` / `#exportProjectBottom`, JSON with embedded base64 media (slow and large for big media). Toast says "Keep it safe as a backup."
- **Bounces to timeline**: Looper `#lpBounce` (the loop region with its FX, as WAV), 80LA8 `#blBounce` (pattern x bars + 2.5 s tail, onto a new "GLCTC1 80LA8 Bounce" track).
- There is no video export, no MP3/stems export and no export of module audio unless bounced.

### 2.12 Transport hub and modules (GLCTC_HUB)
- Registered in this slice: Looper (`lp`) and 80LA8 (`bl`). Others (`mine`, `lee`, `s101`, `go`, `vox`) are registered elsewhere. 90MINE/DIVINE09 begins at about line 1392.
- **Master play** starts all modules that have PLAY WITH MASTER on (`sendEl`) and BYPASS off (`bypassEl`) at a shared start time and step, when MODULES is ON.
- `#modulesBtn` toggles "MODULES ON/OFF" (persisted) and starts or stops modules immediately while playing.
- `#playAllModulesBtn` toggles "▶ PLAY ALL MODULES" / "■ STOP ALL MODULES" and launches at the next 16th of the shared clock.
- Per module: PLAY PATTERN toggles (`lpTransportPlay`, `blPlay`, etc.), STOP, `…Solo` (SOLO PLAY / SOLO ON; the first solo silences others, further solos join), `…ResetAll` buttons (injected next to the Stop buttons, with `confirm()`), `#resetAllModulesBtn` (`confirm`).
- Bypass checkbox greys the panel (`.bypassed`) and stops that module.
- Button labels and states are polled every 250 ms.
- Tempo is shown in `lpTempo`, `blTempo`, `s101Tempo`, `goTempo`, `voxTempo`, `mine909Tempo`, `lee303TempoVal`, `gscBpm`.
- A single `GLCTC_CLOCK` tempo map is the only tempo in the app (every module asks it when a beat happens). Window events `glctc-master-play` and `glctc-master-stop` are dispatched.

### 2.13 Looper / sampler (track type with `looper`)
- Picker `#lpTrack`, create `#lpCreate`, 16 pads (`#lpPads`, pointer down/up) selectable by keys **1-8** (Shift = 9-16; key up releases gate-mode pads) and MIDI notes 36-51.
- Pad modes (`#lpMode`): loop, gate (plays only while held) and shot.
- `#lpRec` records from the mic (auto-stops after `#lpBars` bars if set; plays on finish), `#lpLoad`/`#lpFile` loads a file, `#lpPlay` plays or stops the pad, `#lpClear`, `#lpRev` reverse, `#lpHalf` / `#lpDbl` speed x0.5 / x2 (0.25-2), `#lpLoop` (cosmetic, see bugs), `#lpWarp` + `#lpBars` fit the sample to N bars.
- Sliders (`#lpSliders`): speed 0.25-2, pitch +-12 st, loop start/end, bit depth 1-16, sample-rate crush 1-32, volume 0-1.5, filter cutoff, drive, delay, reverb. Bit/rate changes re-process the buffer after a 120 ms debounce.
- `#lpWave` shows the waveform with dimmed outside-loop regions. Output goes through the track's mixer channel, FX and sends.
- `#lpBounce` renders the pad to a timeline clip. Pad settings persist in the project. **Sample audio does not persist** ("Samples live in this session", `#lpInfo`).
- `#lpTransportLength` is reset to "2" by module reset. A synthetic demo drum loop is generated on init.

### 2.14 80LA8 drum lab (`project.beatLab`)
- 12 voices (Kick, Snare, Clap, Closed Hat, Open Hat, Low Tom, Mid Tom, Rimshot, Cowbell, Conga, Perc 1, Perc 2), 4 patterns A-D (`#blPattern`) of 16 steps with per-step velocity (`#blVelocity` for the selected step), a step grid (`#blSteps`, click to toggle and select), performance pads (`#blPads`), a voice list (`#blVoiceList`).
- Voice panel (`#blFx`): level, pan, pitch +-24 st, decay, tone/filter, overdrive, delay send, reverb send, KEY LOCK, MUTE/SOLO, LOAD SAMPLE or REPLACE SAMPLE (max 4 MB, stored as base64 in the project) and CLEAR.
- Global: `#blSwing`, `#blBars` (used only for bounce), `#blKeyLockAll`, `#blClear`, `#blFill` ("Euclidean": fixed hit counts for kick 4, snare 2, closed hat 8, open hat 4), `#blRandom` (probabilistic fill, with velocity 0.45-0.95), `#blTapTempo` (averages the last 5 taps within 4 s, writes to master BPM), `#blBounce`, `#blPlay` / `#blStop`, `#blMeter`.
- Non-key-locked voices detune with BPM ratio vs `baseBpm`. Programmatic hooks: `GLCTC_80LA8_INPUT / _PRESET / _PATTERNS`.

### 2.15 DIVINE09 / 90MINE (partial, slice ends mid-engine)
- 15 voices (11 synth + 4 sample slots), 4 patterns of up to 128 steps (1/2/4/8 bars, `editBar`), 12 kits (909, 808, 606, 707, linn, dmx, electro, industrial, tribal, breaks, glitch, hybrid), 10 voice profiles, per-channel level/pan/tone/delay/reverb, accent, global swing/level/drive/room/hat/bitcrush/filter, comp + delay + convolution reverb bus. State is saved to `glctc1_90mine_state`. Samples persist in IndexedDB (4 slots). Status text on failure: "SETTINGS NOT SAVED · LOCAL STORAGE FULL"; empty sample slot: "LOAD A SAMPLE INTO n FIRST". Hooks: `GLCTC_DIVINE09_INPUT / _PRESET / _PATTERNS`.

### 2.16 Preamble (766-796)
- Storage never throws (in-memory shim for private mode, `setItem` quota failure warns only). Async rejections are swallowed to the console as "GLCTC1 async notice".
- Every AudioContext is tracked and resumed on the first tap/key/return to the tab. iOS `audioSession.type='playback'` (so the silent switch does not mute). The audio engine is pre-warmed on the first pointer or key.
- **Keyboard ownership**: pointerdown inside `s101Panel`, `wsPanel`, `galacticOnePanel` or `voxPanel` sets `__glctcKeyOwner` so only one instrument plays from the computer keyboard.
- **REFRESH** button: panic-stops all modules and reloads (the tooltip says work is kept). **RESET ALL** button (`confirm('RESET EVERYTHING?...')`): deletes every localStorage key starting with `glctc1` (settings, MIDI bindings, saved WAM list, module state) and reloads. Saved audio projects in IndexedDB are kept. Both buttons are injected into `.brand-right` at DOMContentLoaded.

---

## 3. Keyboard shortcuts and gestures

| Input | Action |
|---|---|
| Space | Play/pause (ignored when focus is in input/select/textarea) |
| Delete / Backspace | Delete the selected clip (no confirm; undoable) |
| Cmd/Ctrl+S | Save to IndexedDB |
| Cmd/Ctrl+Z, Shift+Z, Ctrl+Y | Undo, redo |
| Cmd/Ctrl+C / X / V | Copy / cut / paste clip (paste at playhead) |
| A W S E D F T G Y H U J K O L | Record MIDI notes (only while MIDI recording) |
| 1-8, Shift+1-8 | Looper pads 1-8 / 9-16 (global; hold for gate mode) |
| Double-click track name | Rename (native prompt) |
| Double-click empty lane | New clip (4 bars) or automation object |
| Drag clip / handles | Move (cross-track, same kind) / resize with snap |
| Drag in editor | Select range; gold squares set fades; draw on automation objects |
| Drag ruler markers | Loop start/end |
| MIDI notes 36-51 | Looper pads |
| Pointer down/up on pads | Hold-to-play |

---

## 4. Limits and edge cases
- BPM 30-300. Time stretch ratio clamped 0.2-5; warp rate clamped 0.5-2. Undo depth 80. Zoom 10-64 px/beat. Editor zoom 1-16x. Canvas capped at 16000 px wide.
- WAV export warns at over 10 minutes (600 s). The export length is `totalBeats()`: the longest clip + 4 bars, minimum 32 bars. Even a 4-bar project exports about 59 s at 130 BPM, mostly silence.
- 80LA8 per-voice sample limit is 4 MB. BPM detection reads only the first 240 s. Key detection reads about 40 frames spread across the file.
- Stretch cache is about 300 MB.
- Video-clip audio is routed through `<video>` elements scheduled with `setTimeout` (timing jitter, no look-ahead beyond about 2 beats).
- Web MIDI and `setSinkId` are unavailable in Safari/iOS.
- Clip right-edge extension is limited to the source length (no loop-extending).

---

## 5. UX pain points and bugs

Likely defects
1. **ReferenceError in the sample panel**: line 1044 contains `fmtBpmGLCTC_CLOCK.fmt(...)` (a missing `+` or missing separator). `renderSamplePanel()` will throw whenever a clip has Sync tempo on and a detected BPM. This happens inside `renderEditor`, so the editor refresh can abort partway and the "Playing in ... / tempo X -> Y" text never shows. A designer must preserve the intended text (`tempo <src> -> <master> BPM · key locked / pitch follows tempo`).
2. **Status text doubles as the dirty flag.** `beforeunload` checks whether `#status` contains "Unsaved". Any later `status()` call ("Ready", "Bouncing loop...", "Plugin loaded", "Recording...", MIDI learn messages) overwrites it, silently disabling the unsaved-changes guard. `lpBounce` and `bounce` explicitly end with `status('Ready')` after marking dirty. A redesign needs a real dirty indicator.
3. **Master filter/delay/reverb slider values are not persisted.** Only `mfx` switches and master volume are saved. After reload the slider values come from the HTML defaults.
4. **Export does not match playback.** Export has no output saturator or limiter and no metronome, so hot mixes clip hard in the 16-bit conversion (no dither). It also lacks module audio, WAM effects/instruments, live tempo changes, and the loop region. Reverb IRs are random each time, so exports are not repeatable.
5. **Package export is incomplete for some data.** It misses looper sample audio, DIVINE09 samples (IndexedDB) and `glctc1_90mine_state` (localStorage). Importing a package reuses its `id` and then immediately saves, silently overwriting any saved project with that id, and with no unsaved-changes prompt for the current project.
6. **`#lpLoop`** does nothing except toast "Looper looping is always enabled while playing." (misleading control). The `fillEuclidean` button isn't a real Euclidean generator (fixed hit counts).
7. **Saved WAM list may store dead `blob:` URLs.** Plugins loaded from a local `.js` file are saved by blob URL and cannot be reloaded after a refresh.
8. **WAM load imports arbitrary remote code from the network** (CDN SDK and user URLs) with no warning or sandbox.
9. **MIDI-learn bindings key on element ids.** Controls without ids get `midiLearnControlN`, assigned in tap order, so bindings may point at the wrong control on a later session. There is no way to view, clear or unbind a single mapping (only RESET ALL wipes them). While Learn is on, every click is swallowed.
10. **First play of an undecoded audio clip is silent** (it triggers decode and returns), so a clip can be skipped on first play right after import or load. The only hint is the "analysing…" tag.
11. **Recording picks up the speakers** (playback starts automatically), has no count-in or latency compensation, and no input selector. Stopping also pauses transport.
12. **Global key handlers collide**: digits 1-8 always fire looper pads while any looper track exists (the default project has one). Space with a focused button, and Backspace anywhere outside inputs, act on the timeline (Backspace deletes the selected clip with no confirm).
13. `sendBus`/`delayWet` etc. are legacy; the compressor "limiter" is configured as a pass-through (threshold 0, ratio 1).

Native dialogs and weak feedback (all candidates for in-app UI)
- `confirm`: delete track, clear arrangement, new project (only if clips exist), WAV over 10 minutes, RESET ALL, module RESET ALL (x2 kinds).
- `prompt`: rename track, open saved project (numbered list; there is no list picker, rename or delete for saved projects).
- A single toast slot (2.8 s) means messages can be missed or replaced. Several errors only reach `console.error` (decode failures in `decodeAssets`, the video-peaks failure, 80LA8 sample decode).
- Failure of IndexedDB open shows only a status line plus a toast suggesting "GitHub Pages or localhost".
- Tooltips carry key hints (e.g. rec button: "Record MIDI (keys A–L or a MIDI keyboard)"). A designer must keep those discoverable.
- No autosave. No asset delete/rename, no track reorder, no drag-and-drop, no multi-select, no marquee, no clip snapping to neighbours, no ripple edit, no crossfades, no tempo or time-signature automation, no per-note piano-roll editing, no stems export.
- Performance: `renderTimeline()` rebuilds every row and canvas (500x90 per clip) after most edits. `markDirty()` JSON-stringifies the whole project (including 80LA8 base64 samples) on each change, which will be slow for large projects.

---

## 6. Parity checklist (summary for a redesign)
Must keep: master clock + hub semantics (shared start, bypass, solo, play-all); timeline clip editing (move, cross-track, resize, split, trim-to-playhead, duplicate, copy/cut/paste, fades, gain, numeric bar fields); object editor with range select, cut out, keep, zoom, fade squares; trim bar; piano roll (16-step grid) and MIDI record (computer keyboard + MIDI hardware); audio record; undo/redo (80 deep, coalesced); loop region; snap + grid; metronome; time signature; BPM/key detect + Use BPM, half/double, warp, key lock, pitch/fine; FX tracks with per-target automation, link checkboxes and shapes; per-track FX, inserts (8 effects), instruments (8 presets + WAM), mixer view with meters, HP/booth routing, send to master, cue; master FX; MIDI learn; save/open/new, `.glctc1` package import/export, WAV export with the long-project warning; image/video stage with wide/phone/fullscreen; Looper (16 pads, modes, FX, bounce); 80LA8 (12 voices, 4 patterns, step velocity, samples, swing, tap tempo, euclid/random, bounce); 90MINE; REFRESH / RESET ALL; keyboard shortcuts listed above; mobile label width (170 px at 480 px or below).
