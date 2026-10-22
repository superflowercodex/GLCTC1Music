# E-modules3: daw.html lines 3301-4047 (WORKSTATION / unified console IIFE tail)

Scope note: the slice is the tail of the "GLCTC1 WORKSTATION" IIFE (starts ~3280; MODS at 3284, KEY at 3295) plus the collapse-toggle IIFE (3994-4041) and mobile guards (4043-4046). No standalone instrument synths live here; the instruments (80LA8, DIVINE09, 30LEE, 0010110, GALACTIC ONE, VOX, LOOPER) are in earlier lines and are only *driven* from here. The only sound engine in this slice is PAD-64 (16-voice synth drum/FX + sample pads + 64-step sequencer).

Persistence keys: `glctc1.ws.v1` (localStorage JSON: mods, scenes, rec, pads, lim, wsSend, wsByp; saved 300ms debounced via saveSoon, immediate via save). `glctc1.send.*` / `glctc1.byp.*` (per-module PLAY WITH MASTER / BYPASS checkboxes, '1'/'0': lp, 80la8, 90mine, 30lee, 0010110, galactic-one, vox). `glctc1.collapse.<key>` (panel hidden state). Project-level data (tracks, clips, assets) lives in the host `project`, not in ws storage.

## 0. Module registry (MODS)
8 modules: LOOPER(lp, track-backed, #19baff), 80LA8(bl), DIVINE09(mine), 30LEE(lee), 0010110(s101), GALACTIC ONE(go), VOX(vox), PAD-64(ws). Each non-looper gets an audio bus: in -> vol -> tap(meter/record tap) -> gate(mute/solo) -> StereoPanner -> masterGain. Exposed via `GLCTC_WSBUS(id)` / `WSB(id,fallback)` so other modules route into their bus. Looper uses the timeline track bus instead (vol/pan/mute/solo write to the selected Looper track).
Load restore sanitises: per-module mute/solo are forced false on load; vol<=0.05 reset to 1; pan non-finite reset to 0.

## 1. Transport bar (shared clock sync)
- |< go to start, PLAY/PAUSE (also calls ensureBuses; drives host playBtn), STOP (host stopBtn: timeline + all modules), LOOP toggle (host loopBtn), CLICK metronome toggle, REC (recToggle).
- ALL MODULES start (HUB.playAll, "in sync") and stop (HUB.stopAll).
- BPM readout with -1 / +1 / TAP tempo (needs >=3 taps within 2.5s window, averages interval). Range clamp 30-300, 0.1 resolution; writes host #bpm and fires input+change. Default shows 130.
- BAR:BEAT:TICK and MIN:SEC:MS readouts mirror host #position/#clock (250ms poll).
- PANIC: HUB.stopAll, stop timeline, 30LEE panic, GALACTIC_ONE.panic, stop recording, end audition, stop pads.
- Clock sync: PAD-64 scheduler uses GLCTC_CLOCK.timeOfBeat/beatAt/ensureAnchor and window.__glctcStartStep; so pads lock to the shared anchor with HUB.playAll. Count-in and auto-stop length use GLCTC_CLOCK.bpm and beatsPerBar().

## 2. Module Rack / Mixer strips (per module)
Controls per module: LED (running), PLAY/STOP (HUB.toggleFrom), AUD audition-solo (HUB.soloFrom: plays only that module), S solo, M mute, BYP bypass (toggles module's own bypass checkbox), LEVEL (0-1.25, default 1; Looper 0-1), PAN (-1..1, step .05; knob in console shows C/L/R %), jump arrow (opens/scrolls the module panel), live peak meter (60 dB range, analyser fft 512). Header buttons: CLEAR SOLO, MUTE ALL, UNMUTE ALL. Solo logic: if any module soloed, non-soloed gates close; smoothing 12-15ms. Dim styling on inaudible rows.
Master channel: L/R meters, dB peak readout (-inf below -60), CLIP lamp (latches at >=0.99, tap to clear), MASTER fader (0-1, default = #masterVol or .8, unity mark at .8), FX on/off, FILTER, DELAY, REVERB enables (mirror host mfx), LIMITER toggle.
LIMITER: ON = threshold -1.5 dB, knee 0, ratio 20, attack 2ms, release 100ms; OFF = -4 dB, knee 12, ratio 6, attack 4ms, release 180ms (so "off" is still a compressor). Persisted as ST.lim.
Master mirrors (sliders slaved to host controls): Master volume (%), Filter cutoff (Hz, "OPEN" >=17900), Delay (%), Reverb (%). Ranges inherit from host inputs.

## 3. Master Keyboard Controller ("MASTER KEY 37")
- 37 keys (C to C, 25 on viewport <760px, rebuilds on resize), start octave 4, OCT -/+ range 0-7 (Z / X keys), pointer glissando (slide across keys, note switches), multitouch via pointer ids.
- Touch velocity (default ON): 26-127 from strike height on key (low = harder); PC keys fixed 96 in touch mode. Fixed VELOCITY knob 1-127 default 100 (only active when TOUCH VEL off).
- Knobs (8, drag vertical 170px/range, shift = fine 700px, wheel, arrow keys, dblclick/Home reset): MASTER 0-1 (host masterVol), FILTER 180-18000 Hz exp (host filterCutoff), DELAY 0-.65, REVERB 0-.8, GLIDE 0-1.5 s, VELOCITY 1-127, TRANSPOSE -24..+24 st, BEND RNG 1-12 st (default 2).
- Wheels: PITCH (spring, deadzone .035, springs home, +-bendRange; **applies to new notes only**, no live bend), MOD (non-spring, 0-1; macro-searches range inputs in selected module panels for /modulation|lfo|vibrato|cutoff|brightness|tone/; falls back to master filter 180-18000 Hz). GLIDE macro searches glide/portamento/slide inputs, else only used by 30LEE note duration.
- Buttons: HOLD sustain (also Space when keyboard owner is master), TOUCH VEL, PANIC (release all + GALACTIC_ONE.panic), RESET (wheels/glide/vel/trans/bend/touch/hold).
- PC keys: A W S E D F T G Y H U J K O L P ; ' (18 semitones) with Z/X octave; only when `window.__glctcKeyOwner==='master'`, ignored in inputs/selects.
- Targets (chips, layerable, default GALACTIC ONE): per-module routing in mkNoteOn: GO keyOn/keyOff, VOX keyOn/keyOff, 0010110 noteOn/noteOff, 30LEE note(bent,vel,glide>=.08 or .42 beat) (no note-off, fixed length), 80LA8 & DIVINE09 trigger voice `(note-36) % voices()` (drums: no release), PAD-64 hit `(note-36)%16`, LOOPER hit pad `(note-36)%8` (only if a looper track is selected).
- Util row: FX ON/OFF, LIMITER, IMPORT AUDIO (triggers host #importAudio), EXPORT MIX WAV (host #exportAudio -> exportWav, offline mix of project; see recorder note).
- Transport row beneath: PLAY ALL, STOP ALL, MUTE ALL, UNMUTE ALL, SOLO SELECTED (multi-solo of armed targets), CLEAR SOLO (also clears all timeline track solos).
- Window blur releases all notes.

## 4. Console screen (3 tabs: WAVE / SEQUENCER / RECORD)
- WAVE: live scope of master (_fin analyser fft 2048), scrolling min/max columns (default 25 ms/col; ZOOM +/- halves/doubles, clamp 6-200 ms), dB gridlines 0/-6/-12, peak dB readout (red >=0.99), during record draws red growing waveform with REC timer; count-in shows gold COUNT-IN. Buffer trimmed at 6000 cols to 3000 when not recording.
- TAKE review: after a recording the last take renders as a full waveform with time grid (1/2/5/10/30s steps); click anywhere to play from that point; buttons REC, ▶ TAKE / ■ STOP TAKE, LIVE, ZOOM -, ZOOM +, CLEAR. Take playback goes to c._sat||destination (post-master, bypasses mixer/limiter).
- SEQUENCER tab: simplified view of PAD-64 (see sec 6): PLAY/STOP, pattern A-D, loop 1-4 bars, bar-page buttons (BAR 1-4), FOLLOW (auto page with playhead), RANDOM, CLEAR; 16 rows x 16 steps per page; tap cycles off -> on -> accent -> off, drag paints chosen value; name button auditions + selects sound; per-row M mute.
- RECORD tab: embeds RECORD ANYTHING card.

## 5. RECORD ANYTHING / bounce
- Sources (multi-select chips, default MASTER MIX): master mix (post master FX, `_fin`), any module bus tap, any timeline track bus tap (dynamic list), MIC / LINE (getUserMedia with echoCancellation, noiseSuppression, AGC all off).
- Mode: ONE MIXED TAKE vs SEPARATE STEMS (one MediaRecorder + track per source).
- Length: MANUAL, 1/2/4/8/16 BARS (timer-based setTimeout using beatsPerBar and bpm).
- Count-in: none or 1 bar (click 1500 Hz downbeat, 1000 Hz others, sent straight to destination, not recorded); can be cancelled.
- Transport on record: START NOTHING / START ALL MODULES (default `mods`) / START MASTER PLAY. Records only stops transports it started itself.
- Time readout and level meter during capture.
- Capture engine: MediaRecorder (webm/opus, mp4, ogg; chunks every 200 ms), then decodeAudioData -> WAV via audioBufferToWav (falls back to raw compressed blob if decode fails). Adds asset (name "<src> · take") and a new audio track "WS REC · <name>" with clip at playhead quantised down to 1/4 beat; colour from module. Clip length computed from duration at *current* BPM.
- Download: "LAST TAKE (WAV)" saves every take from the last pass (separate files); filename sanitised, ".wav" even if fallback blob was webm.
- Live strip: ● RECORD button re-targets recording to currently armed modules (overwrites ST.rec.src with `mod:` list, or master if none), PLAY take, STOP (stops record, take, timeline, all modules), DELETE take (confirm; removes asset, clips, empty WS REC track).
- Full-project bounce = host exportWav (outside slice); EXPORT MIX WAV only a trigger here.

## 6. PAD-64 sequencer / sampler (the sampler in this slice)
- 16 sound pads, each with: KIND (16 synth voices: KICK, SNARE, CLAP, HAT C, HAT O, TOM, RIM, CONGA, SUB BASS, PLUCK, STAB, PAD, LEAD, ZAP, RISER, IMPACT), LEVEL 0-1.2 (default .9), PAN -1..1 (defaults spread e.g. snare 0, clap .18, hat -.25...), TUNE -12..+12 st (default 0), DECAY .3-2x (default 1), MUTE, SOLO, TEST, LOAD SAMPLE, CLEAR SAMPLE. Slot drum character is humanised (+-0.4% pitch jitter, random noise offset).
- Sample load: file input accepts audio/*, wav, mp3, ogg, m4a, flac; decoded with Web Audio; name truncated to 14 chars; plays one-shot at tune (playbackRate 2^(tune/12)), decay<1 truncates with fade; **no trim/loop/reverse/ADSR/filter/slicing/choke/root key**. Samples are NOT persisted ("last for this session"; slot.smp reset to '' on boot, so sample pads lose their audio after reload).
- Patterns: 4 (A Club, B Half-time, C Broken, D Fill, factory presets for kick/snare/clap/hats etc.), each 16 lanes x 64 steps with 3 states (0 off, 1 on vel .74, 2 accent vel 1). Loop length 1-4 bars (16th grid, no other resolutions/triplets, no per-step velocity/probability/nudge/pitch). SWING 0-.5 (step 0.01, default .06) delays odd 16ths.
- Tools: STEP, ACCENT, ERASE; PAD REC (tap sound pads during playback, quantised to nearest 1/16 into selected pattern; uses accent if ACCENT tool); CLEAR LANE, CLEAR ALL (current pattern only), RANDOM (density by kind: drums .2, hats .5, others .22; 18% accents), EUCLID with 2-16 hits (default 5; spreads per bar), BAR 1 -> ALL (copies bar 1 to other bars).
- Module layers: checkboxes for 80LA8, DIVINE09, 30LEE, 0010110, GALACTIC ONE, VOX: any hit triggers that module too (voice = lane index mod voices; synths play note 36+(lane%24)); layer set is not persisted.
- Transport buttons: PLAY PATTERN (hub toggle), SOLO PLAY (audition alone), STOP, PLAY WITH MASTER checkbox (`wsSendMaster`, persisted ST.wsSend default true), BYPASS (`wsBypass`, ST.wsByp).
- Scheduler: setInterval 20 ms, look-ahead 120 ms, uses shared clock (GLCTC_CLOCK) so tempo changes and playAll alignment are shared; catch-up if >250 ms late.
- External API: `GLCTC_PAD64_INPUT.hit/state`, `GLCTC_PAD64_PATTERNS.get/set` (pats, bars, swing), `GLCTC_WS` (bus, rec, snap, recall, hit, applyPresetState, exportWav...). HUB.reg('ws') provides reset (restores defaults, clears samples).
- Pads are not a note-timeline instrument: sequences live in ST.pads and are **not written to the project timeline** (no MIDI/clip conversion, no export of the pattern except through recording).

## 7. Scenes (8 slots)
STORE toggle then slot to save; tap filled slot to recall; empty slot shows toast. Snapshot: bpm, per-module run state + vol/pan/mute/solo (looper uses its track), timeline track mute/solo/vol/pan (matched by index AND name), master vol/filter/delay/reverb, limiter, mfx flags. Recall sets tempo, restores mix, then starts/stops modules to match (HUB.startFrom/stopFrom). Does NOT snapshot patterns, sample/synth patches, record settings. No rename, clear, copy, morph/crossfade, or quantised (bar-boundary) launch; recall is immediate. ST.curScene persisted.

## 8. Sequence Tracks (timeline mixer view)
Per timeline track (non-automation): AUD (plays only that track from its first clip until last clip end +400 ms, temporarily soloing it and disabling modules; restores solo), S, M, LEVEL (0-1, default .8), PAN, clip count, jump (selects track + scrolls). CLEAR SOLO / MUTE ALL / UNMUTE ALL. Meters per track. Rebuilt on renderAll when track id/name/color signature changes.

## 9. Live Performance strip
- Per module: ARM (layers on master keyboard), PLAY (sync toggle), SOLO (hub solo-from), AUD (fires a synthetic pointer/click on the module's first pad/key for a sample or sound preview).
- ARM ALL / DISARM ALL, RECORD / PLAY / STOP / DELETE take, DROP (master gain 25ms down, hold 65ms, ramp back by 130 ms; ~0.13 s total, not beat-synced), BUILD (master filter sweep from current cutoff to 18 kHz over 8 beats via 30 ms timer; turns on mfx filter), STUTTER (clicks 30LEE stutter button), CHAIN, CLEAR CHAIN, status line.
- CHAIN: select >=2 faders/knobs/sliders (or pads) then activate; moving one moves others proportionally (normalised 0-1 map across each control's range); chained pads fire each other on press. Not persisted; cannot unlink single items except by re-tapping in select mode.

## 10. Collapse / visibility (3994-4041)
HIDE/SHOW toggle at the top of: Workstation, 80LA8, DIVINE09, 30LEE, 0010110, GALACTIC ONE, GALACTIC VOX, Sampler/Looper pads, Master Mixer, Visual Stage, Object Editor; stored per key; hidden module keeps playing and shows "● RUNNING" tag (400 ms poll); HIDE ALL / SHOW ALL MODULES bar (affects modules + mixer only). Resize event fired on show.
Mobile guard: context menu, text selection, drag suppressed on performance controls.

## UX pain points / gaps
1. PAD samples not persisted; pad kit, layer set, chain links and PAD REC/arm state vanish on reload (samples reset in code at boot).
2. Sampler is one-shot only: no waveform view, trim, loop, slice/chop, root key, pitch-vs-time, filter/ADSR, choke groups, or multisample; max one sample per pad, no drag-and-drop or sample library; no recording straight into a pad (resampling) though a recorder exists.
3. Sequencer limited to 16ths, 4 bars, fixed 4 patterns, no per-step velocity/probability/microtiming/ratchets, no pattern copy/paste/chain/song mode, no undo, no step-length/gate; patterns not shown on the timeline and not exported as MIDI.
4. Pitch wheel and glide only affect new notes; drum modules and 30LEE ignore note-off (no sustain/length control); mod wheel uses fuzzy label matching so effect is unpredictable per module; no MIDI hardware input in this slice.
5. Recording: lands on timeline only at playhead (rounded down to 1/4 beat), no punch in/out, no overdub/loop-record, no input level/monitor control, latency not compensated; takes are MediaRecorder-compressed then decoded (slight codec loss, async); mic hard-codes processing off with no device picker; clip length depends on bpm at record time, so tempo change makes clip drift. DOWNLOAD extension is always .wav even if the decode failed.
6. Count-in click isn't tied to metronome setting or volume and the live ● RECORD silently overwrites chosen record sources.
7. Scenes: no names, clear, delete or quantised/bar-synced launch; patterns and synth patches excluded; track matching by index+name breaks after renames or reorders.
8. DROP/BUILD are fixed-length and not tempo-quantised (DROP) and BUILD timer drifts if tab is hidden; BUILD leaves the filter on/changed with no restore.
9. Mixer: no sends/aux, no insert FX per module, no groups/buses, no routing options, "LIMITER off" still compresses; mute/solo of modules intentionally reset on load (surprising); Looper strip is tied to whichever track is selected (confusing if none).
10. Discoverability: much hidden under collapsed drawers (Scenes, Sequence Tracks, PAD-64 full editor); dense uppercase labels with 8 knobs + 18-key PC mapping; CHAIN select mode hijacks all pointer events with no on-screen list of linked controls.
11. Playback of takes bypasses mixer (post-limiter destination) so audition level differs from timeline playback.
12. Accessibility/robustness: many silent `try{}catch(e){}` blocks hide failures; HUB.playAll relies on DOM-clicking sub-panel buttons for audition (liveAuditionSelectors) which breaks if module markup changes.

## Sync summary
Shared clock: PAD-64 and recording use GLCTC_CLOCK (bpm, timeOfBeat, ensureAnchor) plus HUB (playAll/stopAll/startFrom/stopFrom/soloFrom, per-module send/bypass). Transport buttons delegate to host timeline (playBtn/stopBtn/loopBtn/toStart/metronome). BPM edits propagate through host #bpm events. Scenes restore tempo and module run states.
