# D-modules2: daw.html lines 2401-3300 feature audit

Scope note: the slice holds the second half of GALACTIC ONE (UI: sequencer, keyboards, sound pages, scope, wiring), all of GALACTIC VOX (2604-3274), and the first ~20 lines of the WORKSTATION/PAD-64 module (3278+, covered by the next slice). GALACTIC ONE's engine, params, presets, bounce and recording sit before 2401; the facts below that come from there are marked [outside slice, 1730-2380]. No file in the repo was modified. File content was treated as data; no embedded instructions were found.

Shared infrastructure used by both modules: `GLCTC_CLOCK` (bpm, beatAt, timeOfBeat, ensureAnchor, fmt), `GLCTC_HUB` (reg/toggleFrom/soloFrom/stopFrom, `mods.go` / `mods.vox`), `project` (assets, tracks), `addTrack`, `addClip`, `renderAll`, `markDirty`, `toast`, `masterGain`, `WSB()` (master send), `ensureAudio()` (shared AudioContext), `window.__glctcKeyOwner` (PC-key focus arbitration), `window.__glctcStartStep`.

---
## 1. GALACTIC ONE (id `go`, panel `galacticOnePanel`, accent #40eaff)
Dual-patch (A/B) poly synth + 8-pattern sequencer/arp + dual keyboard. Hub registration: name GALACTIC ONE, start/stop, sendEl `goSendMaster`, bypassEl `goBypass`, reset() restores `defaultState()`.

### 1.1 Step sequencer / arpeggiator card (`buildSeq`, 2401-2472)
- Mode: SEQ / ARP / OFF (segmented). PLAYS target: A / B / A+B.
- 8 patterns A-H (buttons). Per-pattern LENGTH select: 4 / 8 / 16 / 32 steps (grid shows up to 16 columns; 32 steps wrap into two rows). The import path also accepts 12 and 24.
- RATE select (`RATES` [outside slice]: 1/8, 1/16, 1/32, 1/8T, 1/16T, 1/4). DIRECTION select (FORWARD, REVERSE, PING-PONG, RANDOM, DRUNK). ROOT (12 notes), SCALE (12 scales: chromatic, major, minor, dorian, phrygian, lydian, mixolydian, harm minor, minor pent, major pent, blues, whole tone), OCTAVE 1-5.
- SWING knob 0-100%, default 0. Checkboxes: SNAP TO SCALE, KEYS TRANSPOSE SEQ (held key transposes the pattern).
- Pattern tools (all act on the current pattern): RANDOM, ACID, ARP, BOUNCE, TRANCE (generators from `GENS`); EUCLID (uses `prompt()` for hit count 1..len, `Euclid(…, 0)` rotation fixed at 0); MUTATE (25% of steps: toggle on 35%, new scale note 35%, new vel/gate 30%); CLEAR; COPY / PASTE (one clipboard slot, session only); SHIFT left / right; REVERSE; transpose -12, +12, -1, +1 (clamped -12..+24); QUANTIZE (snap all notes to scale); HUMANIZE (vel +/-0.12).
- SONG row: CHAIN PATTERNS checkbox + ORDER text field (e.g. `A A B C`, letters A-H, bad input falls back to the current pattern); LAYER -> PATCH B select (OFF or pattern A-H plays a second pattern on patch B, polymeter allowed); EVOLVE (AUTO-MUTATE) checkbox mutates once per loop. Grid follows chain via `uiQ.chain`.
- Lane tabs (8): NOTE, VELOCITY, GATE, PROB, RATCHET, CUT LOCK, ACCENT, SLIDE. Draw by dragging bars: note range -12..+24 st (36 st, snapped to scale if SNAP), velocity min 0.05 in 1/40 steps, gate min 0.05 in 1/20 steps, probability 0-1 in 0.05 steps, ratchet 1-4, cut-lock -1..+1 in 0.05 steps, accent and slide are toggles (paint value from first click). The ON pad row toggles steps; dragging paints on/off.
- ARP row: MODE (UP, DOWN, UP/DOWN, DOWN/UP, RANDOM, AS PLAYED, CHORD, CONVERGE), OCTAVES 1-4, LATCH (clears held notes when switched off).
- Hint text documents: ARP plays held keys with steps as rhythm; SLIDE = glide; CUT LOCK = per-step filter jump.
- Step playhead and "seq" key-lighting are driven by `uiQ` drained by a 40 ms interval.
- Persistence: sequencer state is part of `ST.seq`, saved by `save()` into localStorage `glctc1_galactic_one_v2` [outside slice]. Clipboard is not persisted.

### 1.2 Dual keyboards and performance (`buildKeys`, 2474-2530)
- Two 25-key pianos (2 octaves + 1): UPPER and LOWER. Per-keyboard OCTAVE 1-7 and TRANSPOSE (-12 / 0 / +12 / +24). Header shows assignment (`→ PATCH A`, `→ PATCH B`, `→ A + B`) from KEYS mode (WHOLE / SPLIT / DUAL set in the patch bar [outside slice]).
- Touch: velocity = vertical position on key (0.3-1.0 scaled by TOUCH), pointer capture, multi-touch via pointerId, slide across keys = glissando (note-off and note-on). Right-click and drag suppressed.
- Wheels: PITCH (-1..+1, springs back in 140 ms, drives `setBend`) and MOD (0..1, latches, drives `setWheel`; mapped to LFO1 and cutoff via `mwvib` / `mwcut`).
- Buttons: HOLD (sustain), STUTTER (cycles 0-4), TAPE STOP (toggle), RESET FX (resets FX to defaults and stutter), MIDI IN (Web MIDI), PC KEYS ON/OFF.
- Knobs: TOUCH 10-100% (default 85%), VOICES 4-24 (default 14), MACROS x4: BRIGHT (-1..+1, drives filter offset +/-2400), MOTION (0..1, LFO depth), SPACE (0..1), GRIT (0..1) [defs outside slice].
- PC keys: upper Q-row `q2w3er5t6y7ui9o0p` (17 keys), lower Z-row `zsxdcvgbhnjm,l.;/`. Fixed velocity .85. Active only when pointer entered the panel (`__glctcKeyOwner==='go'`), ignores modifier keys and repeats, ignores INPUT/SELECT/TEXTAREA focus.
- No sustain-pedal CC64 handling visible in this slice (that lives in `toggleMidiIn` outside the slice).

### 1.3 Sound design (`buildSound`, 2538-2563) - all four sections permanently open
Edits patch A or B depending on EDIT A/B in the patch bar. Knob UX: drag vertical, shift-drag fine, double-tap resets, wheel, arrow keys (2.0 pct per press). Ranges/defaults from [outside slice] `PD`/`FD`.
- OSCILLATORS: DCO1 (wave SAW/SQR/PULSE/TRI/SINE, range 32'-2', fine +/-50c, PW 5-95%, level default 80%); DCO2 (same + semi +/-12, fine +/-100c default +8c, level 70%); SUB (25%), SUB WAVE SQR/SINE, NOISE (0), COLOR WHITE/PINK, RING MOD, X-MOD FM; UNISON ENGINE: voices 1-7 (default 3), DETUNE 0-60c (14), WIDTH 80%, DRIFT 25%.
- FILTER & ENVELOPES: HPF 20-2000 Hz, LPF cutoff 30-18000 Hz (default 5200, exp), RESO 25%, DRIVE 10%, SLOPE 12dB/24dB, ENV AMT -100..+100% (45%), KEY TRK 50%, VEL->CUT 30%; ENV1 filter A/D/S/R (10 ms / 0.4 s / 35% / 0.5 s); ENV2 amp A/D/S/R (10 ms / 0.3 s / 75% / 0.6 s up to 8 s), VEL->AMP 50%, VOLUME 75%.
- LFO & MOD MATRIX: LFO1 shape (SINE/TRI/SAW/SQR/S&H), rate 0.05-30 Hz, SYNC (FREE, 1/1 ... 1/16T), delay 0-3 s, routes ->PITCH (8%), ->CUTOFF, ->PW, ->AMP, WHEEL->LFO, WHEEL->CUT; LFO2 shape/rate/sync; 4-slot MOD MATRIX (source: OFF, LFO1, LFO2, ENV1, MOD WHL, VELOCITY, KEY, RANDOM; dest: PITCH, CUTOFF, RESO, PULSE W, AMP, PAN, OSC2 PITCH, X-MOD; amount +/-100%); VOICE MODE POLY/MONO/LEGATO, GLIDE 0-2 s, BEND RANGE 1-12 st, ENV->PITCH +/-12 st.
- EFFECTS (global, shared across A/B): DRIVE, CRUSH, TRANCE GATE rate (OFF, 1/4, 1/8, 1/16, 1/32) + depth 90%; JUPITER CHORUS mode OFF/I/II/I+II + mix, PHASER mix/rate/depth/feedback; STEREO DELAY mix/time (1/4, 1/8, 1/8D, 1/16, 1/4T, 1/8T)/feedback/tone/STEREO vs PING-PONG; REVERB mix/size ROOM-HALL-CATHEDRAL/damp; AUTO-PAN rate/depth; STEREO width 0-200%; OUTPUT 0-120% (85%).
- Header shows `PATCH A/B · name`.

### 1.4 Patch system [outside slice, 2338-2380 plus PRE/PERF 2025-2100]
- A and B patch slots with names; KEYS WHOLE / SPLIT / DUAL; preset dropdown with FACTORY PATCHES (34), PERFORMANCES dual/split (7), USER PATCHES; SAVE (prompt name, max 32 chars, stored with the global FX in localStorage `glctc1_galactic_one_user_patches`), DEL (user only), EXPORT (`.go1.json`, includes name, patch, fx), IMPORT, RANDOM (randomPatch), INIT, A->B copy, A<->B swap.

### 1.5 Scope, planet, playhead (2566-2580)
- Canvas scope + 48-bar spectrum and waveform, planet glow `--lvl`. Paused when panel is hidden or collapsed. 40 ms UI timer.

### 1.6 Transport, record, bounce, clock [wiring 2582-2600; engine outside slice]
- Buttons: CREATE TRACK (adds an audio track, color #40eaff, volume .8, selects it), PLAY (hub toggle), SOLO PLAY (hub solo; label flips to "SOLO ON"), STOP, REC AUDIO (MediaRecorder on `rig.out` -> clip at playhead floor-to-quarter-beat, name "GALACTIC ONE Performance", adds asset + audio track "GALACTIC ONE · Audio"), REC MIDI (adds MIDI track + clip, 8 bars long initially, captures live keys and sequencer notes with beat positions from performance.now / rig time, clip length trimmed on stop), SEND MIDI (pattern -> new MIDI track "Pattern X", respects ratchets, gate, accent +22% velocity, layer), BOUNCE (OfflineAudioContext 44.1 kHz stereo, length `goBars` select x beatsPerBar + 4 s tail, renders sequencer or arp; WAV asset; added as "GALACTIC ONE · Bounce" at the playhead), PANIC.
- `goBars` select (value from `ST.seq.bars`) sets bounce/MIDI export length. Bounce refuses in ARP mode with no held notes and in OFF mode.
- PLAY WITH MASTER (`goSendMaster`) routes to master bus; BYPASS (`goBypass`). Tempo label updated from the shared clock (`GLCTC_CLOCK.fmt(bpm) BPM`).
- Clock sync: uses the shared hub/clock; no tap tempo or local BPM control inside the module.
- Project integration: `project.galacticOne = ST` (full state persisted with the project). A 1.2 s poll detects a different `project` object and reloads state, rebuilding all UI. API `window.GALACTIC_ONE`: `patterns.get/set`, `noteAt(m,v,when,dur)`, `state`, `project`, `panic`, `playNote`, `bounce`, `getRig`, `keyOn`, `keyOff` (used by other modules/automation).
- Persistence keys: `glctc1_galactic_one_v2` (state), `glctc1_galactic_one_user_patches` (user patches), project field `galacticOne`.

### 1.7 UX pain points (Galactic One)
- Uses browser `prompt()` for EUCLID hits and SAVE patch name; blocking, no rack styling, no overwrite confirm.
- Pattern clipboard only one slot and not persisted; no undo/redo for generators, MUTATE, CLEAR.
- Grid caps at 16 columns, 32-step patterns wrap with no separate bar numbering; lane drawing has no per-lane value readout except note name.
- Sound-design page is four always-open long sections (~90 knobs), which is heavy to scroll; no macro-assign or MIDI-learn; no knob automation recording to the timeline.
- Mod wheel does not spring but pitch wheel does (correct), but no sustain pedal UI indicator; HOLD is a global toggle.
- Bounce length is bars only (no loop-region or clip-range option); live REC AUDIO captures only post-master-tap, no stems per patch A/B.
- Preset select resets to blank after each load, so the current preset is not shown (only the patch name in the A/B button).
- Export is file-only (no cloud/project library); user patches live only in one browser's localStorage.
- Hardcoded PC keys assume a QWERTY layout; the same keys are used by VOX, with ownership decided only by pointer-enter.
- Bounce failure message says "Try again in Chrome" with no detail; no progress indicator during render.

---
## 2. GALACTIC VOX (id `vox`, panel `voxPanel`, accent #ff7ad9; 2604-3274)
Vocal engine: mic/file input -> pitch/formant, auto-tune, 3-voice harmonizer, channel vocoder, FX rack, SPACE MOD reverb; plus formant choir, synthesized piano, multi-sampler on keys, 16 pads, singing sequencer.

### 2.1 Input and vocal processing
- Input buttons: MIC (getUserMedia with echoCancellation, noiseSuppression, autoGainControl all OFF; status warns to use headphones), LOAD VOCAL FILE (audio/*; loops), FILE play/stop, drag an audio file onto the input bar to load it. File name displays (26 chars).
- INPUT: IN GAIN 0-300% (def 100%), GATE 0-100% (5%; threshold = value*0.06 on RMS, closes at 60 ms release, opens at 10 ms), COMP 0-100% (40%; threshold -8..-42 dB, ratio 2..12), VOICE LEVEL 0-120% (90%).
- PITCH -12..+12 st (step 1), FORMANT -12..+12 st (step 1; implemented as 3 peaking-filter pairs).
- AUTO-TUNE: ON/OFF, KEY (12), SCALE (11 scales: chromatic, major, minor (default), dorian, phrygian, lydian, mixolydian, harm minor, minor pent, major pent, blues), SNAP SPEED 0-100% (60%; time constant 4 ms to ~254 ms). Pitch tracker: YIN, 70-1000 Hz, run every 30 ms (every 250 ms when not needed). On-screen TUNER shows note, cents, and target note.
- HARMONIZER: mode INTERVAL / SCALE DEGREE / FOLLOW KEYS (follows held keys); 3 voices each with interval -12..+12 st (defaults +4, +7, -12), LEVEL 0-100% (defaults 0), PAN -100..+100 (defaults L60, R60, C). Granular worklet pitch shifter (`gv-ps` AudioWorklet, loaded from data URL, falls back to blob URL; if worklet fails: no pitch/formant/harmony/shimmer/gravity, dry only).
- VOCODER: ON/OFF, CARRIER (SAW CHOIR, PULSE, NOISE (WHISPER), PIANO, VOICE GEN), BANDS 8/12/16/24, BAND Q 2-30 (9), FORMANT SHIFT +/-12 st, RESPONSE 15-150 Hz (55), SIBILANCE 0-100% (45%, HPF 6 kHz bypass), VOCODER LVL 0-200% (90%). Band range 90 Hz - 8.5 kHz log spaced.
- VOCAL TYPE presets (19, in the input bar): NATURAL, MALE->FEMALE, FEMALE->MALE, CHILD, GIANT, DEMON, ROBOT, ALIEN, WHISPER, CHOIR OF ME, ANGEL, TELEPHONE, MEGAPHONE, TRAP AUTOTUNE, HYPERPOP, DARK PRAYER, STADIUM DOUBLE, GLITCH VOX, VOCODER CHOIR. Applying a type resets 36 "type keys" to defaults, then applies overrides. No user types, no type amount/mix.

### 2.2 Voice generator (formant choir)
- Voice type: BASS, TENOR, ALTO, SOPRANO, CHOIR (ALL = layered bass/tenor/alto/soprano, drops layers when voices >10). VOWEL: AH, EH, EE, OH, OO, LYRICS (parses syllable consonant + vowel from the LYRICS text, cycles per note). 5-formant bandpass bank from tables (soprano/alto/tenor... 5 sets x 5 vowels), consonant onset noise for s/t/k/p/f/h/c, glide for l/m/n/r/w/y/v/b/d.
- ATTACK 5 ms-2 s (120 ms), RELEASE 50 ms-4 s (0.9 s), VIBRATO 0-100% (35%; fade-in 0.25-0.9 s), VIB RATE 2-8 Hz (5.2), BREATH 0-100% (12%), ENSEMBLE 0-40c (12), VOICES/NOTE 1-4 (2; auto-reduces under load), CHOIR LVL 0-150% (80%).
- LYRICS text field (default "la lo ah ooh la na ay oh"); GENERATE SONG fills 8 random syllables.

### 2.3 Piano / multi-sampler
- Additive grand piano synthesized to buffers on first use (3 timbres: GRAND, BRIGHT, FELT; 22 sample points, 4 st spacing from m24-108, 24 kHz stereo, async, status "PIANO READY"; uses triangle fallback until ready). Fourth option MY SAMPLE (multi-sampler).
- Controls: INSTRUMENT, BRIGHTNESS 0-100% (60%; low-pass), RELEASE 50 ms-3 s (0.35), HAMMER 0-100% (45%, noise thump), PIANO LVL 0-150% (85%).
- Sampler: drag audio files onto keys (several at once fill consecutive keys), LOAD SAMPLES -> KEYS (loads onto the root key `ROOT OCT 1-7` / `ROOT NOTE`), CLEAR KEY SAMPLES; nearest-sample re-pitching; S.ATTACK 1 ms-2 s, S.RELEASE 50 ms-4 s, LOOP off/on. Samples that loaded switch INSTRUMENT to MY SAMPLE and KEYS PLAY to PIANO.
- KEYS PLAY target: PIANO / CHOIR / SYNTH (VOCODER) / ALL. Vocoder synth carrier = 3 detuned saw/square + sub sine.
- Polyphony: no user setting; soft cap ~30 voices (oldest killed down to 20).

### 2.4 Keyboard and performance
- One 25-key piano with OCTAVE 1-6 select, touch velocity by vertical position (0.35-1.0), slide glissando, multitouch, PC keys Q-row (`q2w3er5t6y7ui9o0p`), PC KEYS toggle (default ON), HOLD (sustain), MIDI IN (Web MIDI; notes 36-51 trigger pads, other notes play keys, CC64 sustain, no pitch bend/mod/CC). Keys with a mapped sample/pad show a "smp" style and tooltip.
- Key->pad map: select pad, tap a piano key, MAP SELECTED PAD -> KEY (root = that key, pitch follows keyboard); CLEAR KEY MAP.
- HYPERSPACE (3.2 s noise riser into FX bus, fire and forget), BLACK HOLE (hold: gravity reverb up, dry ducked to 12%), REVERSE (toggle, reverses buffers on mapped pad keys only), ALL FX ON / BYPASSED (kills drive, chorus, delay, reverb, space reverb), SPACE FX shortcut (jumps to the last tab).

### 2.5 Pads (16)
- 4x4 pads: tap/click triggers (velocity from vertical position 0.3-1.0), drag audio files on a pad (multiple files fill consecutive pads), LOAD SAMPLE per pad, per-pad RECORD / STOP from the microphone (separate getUserMedia + MediaRecorder, decoded and stored as "PAD n Recording"), CLEAR PAD, CLEAR ALL PADS. Per-pad editor: PAD VOL 0-150%, PAD PITCH -24..+24 st, PLAY MODE ONE-SHOT / GATE / LOOP. Pad hit retriggers (kills previous voice).
- Pad names show first 14 characters. Big live waveform/spectrum canvas (1400x260, shown 180 px tall) with state line (MIC LIVE / VOCAL FILE PLAYING / READY).
- Pads are NOT saved: PADS, KM (key samples) and padKeyMap are in-memory only ("Sample mappings last for this session").

### 2.6 FX rack
- TONE/DRIVE/CHORUS: DRIVE 0-100% (tanh waveshaper, 2x oversample), LOW SHELF +/-12 dB @180 Hz, AIR/HIGH +/-12 dB (def +2) @6.5 kHz, CHORUS 0-100% (20%).
- PING-PONG DELAY: mix 15%, time 1/4, 1/8, 1/8D, 1/16, 1/4T, 1/8T (tempo-synced to shared BPM; default 1/8), feedback 0-90% (35%). Delay re-synced every 300 ms to clock BPM.
- REVERB: mix 22%, ROOM / HALL / CHAMBER (0.9 / 2.2 / 3.6 s synthetic IR, regenerated on change), DAMP 800-16000 Hz (7000), STEREO width 0-200% (110%, mid/side), OUTPUT 0-120% (85%). Output limiter fixed (threshold -4 dB).
- SPACE MOD: SPACE VERB mix 30%, SPACE SIZE NEBULA 3 s / CATHEDRAL 5.2 s / VOID 9 s, PRE-DELAY 0-250 ms (40), SHIMMER up-octave, GRAVITY down-octave, NEBULA MOD depth + rate (0.05-2 Hz), ORBIT PAN depth + rate (0.05-4 Hz), RADIATION (tremolo, 0.5-40 Hz), COMET FILTER (auto-filter sweep, 0.05-4 Hz).

### 2.7 Sequencer / transport / sync
- Singing sequencer (16 steps; LENGTH 4/8/16): SEQ PLAYS (target instruments), RATE (1/8, 1/16, 1/32, 1/8T, 1/4), ROOT, SCALE (11), OCTAVE 1-5, CHORDS (scale triads from each step note), per-step ON + pitch via drag (snapped to scale, -12..+24), velocity fixed .85 (not editable in UI, only via generate/melody which randomize it), gate (`Q.gate` .8, not in UI; GENERATE sets .9). Tools: GENERATE SONG (random melody + lyrics + sets choir/atmosphere params, auto-starts the sequencer), MELODY, CLEAR.
- Transport: PLAY PATTERN (hub toggle), SOLO PLAY, STOP, PLAY WITH MASTER, BYPASS, PANIC, CREATE TRACK (audio track "GALACTIC VOX · Track", pink #ff7ad9), tempo display. Lookahead scheduler (20 ms tick, 140 ms lookahead) on `GLCTC_CLOCK.beatAt/timeOfBeat`, so it follows the global clock, tempo changes and `__glctcStartStep`; sequencer rate changes realign to grid.
- Record: REC AUDIO captures the module's output tap through MediaRecorder -> asset "GALACTIC VOX Take" -> new audio track "GALACTIC VOX · Take" with clip at playhead. NO MIDI recording (`capLive`/`capSeq` are empty stubs), NO bounce/offline render, NO "send MIDI to timeline".
- Persistence: localStorage `glctc1_galactic_vox_v1` saves `{S,Q}` (all params, vocal type, lyrics, PC key flag, kbOct, sequencer pattern) with a 500 ms debounce. NOT saved into the project file (no `project.vox`), no restore from project. Reset via hub: `S=defS(); Q=mkQ()`.
- Public API `window.GALACTIC_VOX`: `patterns.get/set` (steps, len, root, scale, oct), `noteAt`, `state`, `ensure`, `keyOn/keyOff`, `padOn`, `assignKeys`, `assignPads`, `PADS`, `KM`, `V`, `generate`, `micToggle`, `applyType`, `decodeFile`, `panic`, `renderPiano`, `start`, `stop`, `hasWL`.

### 2.8 UX pain points (Galactic Vox)
- No preset/patch system beyond the 19 VOCAL TYPES: no save/load/export of user voices, no import/export of pad kits or sampler maps; "SPACE MOD" and other FX have no presets.
- Pads, key samples and pad-key maps vanish on reload and are not stored in the project, so a saved project loses its vocal samples.
- Project does not restore VOX state (only localStorage per browser); two projects share one VOX setup.
- Mic input: no input device chooser, no latency/monitoring control, no input meter beyond the scope, no record-armed punch-in, no count-in, no take lanes/comping; live monitoring via speakers feeds back (only a status warning).
- REC AUDIO ignores the project transport (does not start playback) and does not render/apply timeline context; no MIDI record, no bounce of the sequencer, no export of dry vs wet.
- Per-step velocity/gate/probability/ratchet not editable (Galactic One has all); fixed 16 steps; step lengths limited to 4/8/16; no swing, no pattern bank/chain.
- No pitch-correction visuals (only text tuner); auto-tune has no humanize/retune ranges or per-note edit; harmonizer follow-keys uses only first three held keys.
- Pitch shifter quality: simple two-tap granular (2048 window) - artifacts and latency; formant shift is an EQ tilt, not true formant shifting.
- PC keys: only Q-row (17 keys) vs Galactic One's two rows; the two modules compete for keys (decided by hover/click).
- Black Hole requires press-and-hold (hard on touch, no latch); HYPERSPACE no length setting; "SPACE FX" button clicks last tab by DOM position.
- Sample loader confusion: Hint says "set INSTRUMENT to MY SAMPLE (switches automatically)"; REVERSE only affects pad-mapped keys; no waveform/trim/slice on pads; one-shot pad length is full buffer.
- All sections are in tabs, while Galactic One shows everything open: inconsistent module UX.
- Uses `prompt()` nowhere here, but errors are only `toast()`/status text; worklet failure silently degrades.

---
## 3. WORKSTATION / PAD-64 (starts 3278; only the intro lies in this slice)
- Header comment: "master control, module rack, 64-pad sequencer, record-anything". Module registry in this slice: LOOPER `lp` (track-capable), 80LA8 `bl`, DIVINE09 `mine`, 30LEE `lee`, 0010110 `s101`, GALACTIC ONE `go`, VOX `vox`, PAD-64 `ws`, with colors. Pad kinds: KICK, SNARE, CLAP, HAT C, HAT O, TOM, RIM, CONGA, SUB BASS, PLUCK, STAB, PAD, LEAD, ZAP, RISER, IMPACT (16 lanes x 64 steps). Persistence key `glctc1.ws.v1`. Rest of the module belongs to the next audit slice.

## 4. Cross-module gaps worth tracking against a DAW parity checklist
1. VOX lacks project persistence, MIDI record, bounce, step parameters and preset save/load that GALACTIC ONE has.
2. Neither module records automation to the timeline; MIDI clips only from GO.
3. Neither exposes MIDI learn, MPE/CC mapping, or a clip-launch hook.
4. Both use MediaRecorder (webm/opus) for live recordings (lossy) while bounce is lossless WAV (GO only).
5. Both depend on a shared tempo only: no time-signature control inside modules (GO uses `beatsPerBar()`; VOX is fixed 4/4 grid math).
