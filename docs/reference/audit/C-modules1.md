# C-modules1: daw.html lines 1501-2400 feature audit (read-only)

Scope: tail of DIVINE09 (module starts at 1392; I read 1392-1500 + HTML 365-371 for defaults), 30LEE (1566-1640), 0010110 SYNTH (1641-1711), GALACTIC ONE v2 (1712-2400 JS; the sequencer UI/knobs build continues past 2400, not covered). HTML panels at 365-398 read for labels.

Shared infrastructure seen in this slice
- Clock: `GLCTC_CLOCK` (bpm 30-300, default 130; `timeOfBeat(beat)`, `beatAt(t)`, `ensureAnchor(step)`, `syncDelay`). Every sequencer uses a 20 ms setInterval scheduler with 0.12-0.14 s lookahead and absolute-step to audio-time mapping (no private drift). Start step from `window.__glctcStartStep`.
- Hub: `GLCTC_HUB.reg(id,{name,start,stop,running,sendEl,bypassEl,panel,reset})`. Each module has: PLAY (toggle), SOLO PLAY (other solo modules join same clock), STOP, PLAY WITH MASTER checkbox (send to master mixer via `WSB(id, masterGain)`), BYPASS checkbox, reset hook.
- Shared range of patterns: A/B/C/D 4-pattern banks on Divine09/30LEE; 8 patterns + chain on Galactic One; single pattern on 0010110.

---
## 1. DIVINE09 (hybrid drum machine, internal id `mine`, "90MINE" legacy key)

### Voices (15 channels)
KICK, SNARE, CLAP, CLOSED HAT, OPEN HAT, LOW TOM, MID TOM, HIGH TOM, RIM, RIDE, CRASH + SAMPLE 1-4 (v 11-14). Closed hat chokes open hat. Per-hit random hum (+/-0.5% pitch), random noise start so repeats differ. Velocity brightens (br=.6+.4*vel).

### Kits (12, `S.kit`, default 909)
909 punch, 808 deep, 606 bright, 707 digital, Linn-style, DMX snap, Electro, Industrial, Tribal, Breaks, Glitch, Hybrid. Each = kitChar multipliers {f pitch, d decay, b brightness, n noise} and a default voice profile (909,808,digital,digital,analogue,tight,digital,metallic,wide,tight,noise,analogue).

### Voice Designer (per channel profile)
Profiles: FOLLOW KIT, 808, 909, analogue, digital, metallic, noise, sub, tight, wide (per-voice select, default FOLLOW KIT). Profile params (internal, not user-editable): kick freq/pitch-drop/decay/click/wave/sat/noise, snare freq/decay/noise/tone/wave, clap bursts/decay/spacing, hat decay/open/noise/metal/scale, tom decay/freq/click, wide-detune layer, metal layer.

### Per-channel mixer (15 channels, shown in voice cards)
LEVEL 0-1 (1), PAN -1..1 (defaults hats/toms/rim/ride/crash spread, e.g. closed hat .18, open -.12, low tom -.28, mid 0, high .28, rim .14, ride .3, crash -.3), TONE -1..1 (0; negative = lowpass 500Hz-20k, positive = +9 dB high shelf @3.2k), DELAY SEND 0-1 (0), REVERB SEND 0-1 (default 0-.14 per voice).

### Master / global controls
- MASTER LEVEL 0-1 (.85), DRIVE 0-1 (.18; tanh k=1+10*drive, 4x oversample), ROOM/REVERB 0-.7 (.12), HAT TONE .1-1 (.65), BITCRUSH 0-1 (0; 2..128 steps), FILTER SWEEP 0-1 (1; lowpass 350 Hz-18 kHz, squared curve), SWING 0-.6 (.08; applied to odd 16ths), STUTTER/GATE toggle button.
- Bus: master gain > compressor (-16 dB, 3.5:1) > lowpass > crusher > saturator > WSB('mine'). Delay is fixed dotted-eighth (0.75 beat) synced to bpm, feedback .3, wet .4, LP 3.2k; reverb = generated 0.95 s IR.
- STUTTER: setInterval at max(35ms, 16th/2) toggling master gain 1 <-> .0001 while running. Free-running timer, NOT locked to clock phase; stays "ON" even when transport stopped.

### Pattern features
- 4 patterns (A Club Driver, B Warehouse, C Broken Beat, D Fill/Chaos random), 15 rows x up to 128 steps (MAX 128).
- LOOP LENGTH 1/2/4/8 bars (default 2); EDIT BAR 1-8 selects which 16-step page is displayed.
- Step: on, accent, velocity (default .72; accent=1.0 and x1.12 at play; range load clamp 0-1.25). Click = toggle, shift-click = accent (UI only; no velocity editing, no per-step probability, no ratchet, no per-step swing/nudge).
- Tools: RANDOMISE (per-row density: kick .5, hat .72, others .2; 18% accents), CLEAR (current pattern only), COPY BAR -> NEXT (also advances edit bar; wraps), EUCLIDEAN FILL (rewrites ALL steps of the pattern with fixed per-voice hit counts; discards existing pattern), HALF-TIME, DOUBLE-TIME, REVERSE BAR (edit bar only).
- LIVE DRUM PADS: tap-to-audition buttons (vel .9). No record into pattern, no keyboard mapping, no MIDI in, no velocity from pointer.
- External API: `GLCTC_DIVINE09_INPUT.trigger(i,vel,when)` (used by master keyboard/MIDI), `GLCTC_DIVINE09_PRESET` get/set (settings, keeps patterns), `GLCTC_DIVINE09_PATTERNS` get/set.

### Samples (4 slots)
File input per slot (audio/*, wav/mp3/ogg/m4a/aiff), PREVIEW, CLEAR. Decoded with decodeAudioData; persisted in IndexedDB `glctc1_divine09_samples` / store `samples` (bytes+name); restored on load. Plays one-shot at fixed pitch, no trim/gain/pitch/reverse/choke/loop. Kit JSON does not include sample audio (UI note says so).

### Persistence
- localStorage `glctc1_90mine_state` (full state S, incl. patterns, sv:2). NOT stored in the `project` object (no markDirty) so DIVINE09 patterns/kits are not saved with the DAW project/export, and are shared across all projects.
- SAVE KIT JSON / LOAD KIT JSON: file `GLCTC1_Divine09_Kit.json` {brand,version:2,state}. Sanitises on load. Only one slot (no named presets list, no pattern-only export).
- Reset (hub): defaults + knob UI refresh.

### Sync to clock/timeline
- Steps = 16ths from `GLCTC_CLOCK` absolute step (loop = bars*16), swing computed per step duration, tempo changes handled by clock. Delay time updated from clock.bpm only when updateFx() runs (on slider moves/start), not on bpm change.
- Playing step highlight via setTimeout per step (UI only).
- Timeline: **no REC AUDIO, no REC MIDI, no BOUNCE, no SEND MIDI**. Output cannot be committed to the arrangement from this module. `＋ CREATE TRACK` button (id mine909CreateTrack) has **no click handler anywhere in daw.html** (dead button).

### UX pain points (Divine09)
1. Cannot print to timeline at all (no bounce/rec/midi) - biggest gap vs the other synths.
2. Dead CREATE TRACK button.
3. State not part of project; opens with previous browser state in a new project.
4. Step buttons only toggle/accent; no velocity lane, no per-step probability/ratchet/flam, no mute/solo per row, no row clear/random, no per-row length.
5. Euclid fill is destructive with hardcoded hit counts and no Undo; transforms act only on edit bar; RANDOMISE/CLEAR act on whole pattern with no confirmation/undo.
6. Samples: no waveform, trim, pitch, gain, choke group; sample channels have no per-sample pitch.
7. Stutter is free-running, not beat-locked, and survives STOP.
8. Voice profile engine params (tune/decay per voice) are not exposed; only pick profile + tone.
9. Pattern selectors A-D are a dropdown (no live pattern chaining/queue), loop length change is not quantised.
10. Pad hits ignore velocity and aren't recordable; mobile 28px step buttons with 16 columns.

---
## 2. 30LEE (Devil Fish-inspired acid mono bass, hub id `lee`)

### Sound controls (sliders, live)
Cutoff 80-12000 Hz (900), Resonance 0-25 (13), Env mod 0-1 (.72), Decay 50-1500 ms (.22 s), Attack 1-150 ms (4 ms), Sub level 0-1 (.24), Drive 0-1 (.55), Voice level 0-1 (.68).
Selects: Oscillator saw/square/triangle (saw), Octave shift -1/0/+1 (0), Filter mode lowpass/bandpass/highpass (lowpass), Sub waveform square/sine/triangle (square).
Accent amount 0-1 (.7), Slide time 0-350 ms (90 ms), Pattern probability .1-1 (1), Gate .15-1.4 (.72), Swing 0-.6 (.08).

### FX bus ("FX DESTRUCTION BUS")
Saturation/drive 0-1 (.55), Dub delay 0-.75 (.14), Delay feedback 0-.78 (.28), Reverb send 0-.65 (.12), Bit reduction 0-1 (0), FX mix 0-1 (.28), FX low-pass 500-18000 Hz (12000), Stereo width 0-1 (.22; **stored but no node uses it**). Delay time fixed at 0.75 beat from bpm (set on getFx call). Note: "FX low-pass" is the same biquad as the mod-selected filter type, and its Q is derived from resonance - not a dedicated FX filter; the label "chorus-style detune" in the hint is not implemented.

### Pattern / sequencer
- 4 patterns (A Acid Line, B Rave Push, C Broken Signal, D Chaos Fill (random on)), 16 steps stored; PATTERN LENGTH 8 or 16 steps (state allows S.length; selector options 8/16).
- Step: on, note (MIDI, default bassline in C2 region), accent, slide, velocity (.78, not edited in UI). Click toggles on; shift-click toggles accent; right-click toggles slide (touch has a shift+touch hack). Selected step note edited by NOTE slider (MIDI 24-60) or double-click a keyboard key. Note name shown on step.
- ACID GENERATOR: scale (Minor, Major, Phrygian, Dorian, Pentatonic, Chromatic) + octave (1-4) select; fills current pattern (.95 chance on beats, .58 else; 16% octave jump, 24% accent, 22% slide).
- CLEAR (current pattern), PATTERN PROBABILITY applies per step.
- Gate slider sets duration relative to the step; swing applies to odd steps.
- Accent: filter cutoff x1.45, Q +2, amplitude up to 1+accent*.8, decay x.72. Slide: linear pitch glide from previous freq over slide time. Mono-ish (lastFreq tracking) but notes can overlap (no true mono voice cut).
- Live keyboard: 13 keys C2-C3 (MIDI 36-48), pointerdown plays 0.25 s note (no pointer-up release, no velocity); double-click assigns note to selected step.

### Arpeggiator
Toggle (ARP OFF/ON), Mode up/down/updown/played/random, Rate 1/4,1/8,1/8T,1/16,1/16T,1/32, Octaves 1-4, Gate .15-1 (.72). Arpeggiates the enabled steps of the current pattern (not held notes). Clock-locked via GLCTC_CLOCK beats with re-anchor on rate change. Runs independently of the step sequencer (both can sound at once). Stops when PLAY STOP pressed; sets arpOn false.

### Performance
STUTTER (adds 3 repeat notes at 45 ms), FILTER FREEZE (halves cutoff; unfreeze does not restore - bug: only multiplies on engage), TAPE DROP (arms; next scheduled step is swallowed and flag cleared - not a real tape stop), PANIC / MUTE (stop, kills active oscillators, clears flags).

### Recording / bounce
- BOUNCE -> TIMELINE: OfflineAudioContext 44.1 kHz stereo, steps = LOOP LENGTH (1/2/4/8 bars, default 2) x 16, tail 2.2 s, uses current pattern + prob + swing; adds asset 'GLCTC1 30LEE · Acid Bounce' + new audio track 'GLCTC1 30LEE · Acid' (#ff5ba4) clip at playhead (quantised to 1/4 beat). Bounce stops live playback first. Random probability makes bounces non-deterministic. Does not include arp.
- No REC AUDIO, no REC MIDI/SEND MIDI. CREATE TRACK button has no handler.

### Persistence
`project.glctc30lee` (saved with project, markDirty) and localStorage `glctc1_30lee_preset` (write-only; never read back). `getState` loads from project only, so a fresh project has no restore of the last localStorage session. Exposed API: `GLCTC_30LEE_INPUT.note`, `GLCTC_30LEE_PRESET`, `GLCTC_30LEE_PATTERNS`. Reset sets S defaults. No patch presets, no import/export, no named sounds.

### Clock
Steps from absolute clock (next/4 beats), swing uses step duration; tempo displayed "MASTER TEMPO - locked to DAW BPM". `S.tempo` mirrors bpm but unused for timing. Note: `S.freeze/stutter/tape` flags are persisted into project state.

### UX pain points (30LEE)
1. Freeze irreversible; tape drop is misnamed; stereo width slider and resonance range label mismatch (res up to 25 but Q capped 30 + accent).
2. CREATE TRACK dead; no MIDI/audio record; bounce randomises with probability.
3. Live keys: no sustain/release, no velocity, no computer-keyboard mapping, no MIDI in, no octave shift.
4. No velocity editing, no per-step gate/probability; right-click slide not discoverable on touch/trackpad; shift-click needed for accents.
5. Pattern length only 8/16 with no 32; pattern change not quantised; arp and sequencer can overlap unintentionally.
6. FX filter reuses mod filter type (band/high-pass applies to whole FX bus).
7. No preset browser/randomize-sound/patch save; localStorage write-only.

---
## 3. 0010110 SYNTH (SH-101-inspired mono/poly layer synth, hub id `s101`)

### Oscillator / main controls (14 sliders + wave)
Wave sawtooth/square/triangle/sine (saw), Sub level 0-1 (1), Noise 0-.6 (0), Pulse width .1-.9 (.5; only on layer 0 square), Filter cutoff 40-16000 Hz (4200), Resonance .1-18 (5), Filter envelope 0-1 (.55), Attack .001-1 s (.008), Decay .01-2 s (.18), Sustain 0-1 (.58), Release .01-3 s (.22), LFO rate .1-20 Hz (4.5), LFO depth 0-1 (0), Glide 0-.5 s (.025), Synth level 0-1 (.72).
Notes: one amp ADSR shared by all oscillators/sub/noise/sample; filter env is a global "bus filter" decay sweep triggered per note (shared filter, so overlapping notes retrigger the same filter); LFO depth is the only LFO destination (cutoff, +/-30 Hz scale - very weak); sub is sine only; pulse-width via periodic wave.

### Layer Lab (3 layers)
Each: Enable, Wave (saw/square/triangle/sine), Octave -2..+2, Semitone -12..12, Detune -50..50 ct, Level 0-1. Defaults: L1 saw 0 level .8, L2 square -1 oct detune -7 level .34, L3 triangle +1 detune +7 level .25 (off). Layer 1 uses the main wave. Sample layer plays beside layers (playbackRate relative to C4).

### Arp / sequencer
- 16-step local PATTERN (independent of arp): step on/off, note = scale degree index (0-based, wraps octaves), accent, velocity (.82, accent 1.12x). Pattern LENGTH 8 or 16, ROOT note C2-C4 selectable (C2,D2,E2,G2,A2,C3,C4 in HTML), SCALE Minor/Major/Phrygian/Pentatonic/Chromatic, GATE .1-1 (.72). Click toggles, shift-click accent, double-click cycles scale degree. GENERATE (random), CLEAR STEPS. Locked to clock via 16th steps. No swing, no slide/tie, no per-step gate.
- Keyboard ARP: checkbox ARP, MODE up/down/updown/played/random, RATE 1/4..1/32 incl. triplets, OCTAVES 1-4, GATE .1-1, SWING 0-.5 (**stored but never used**), LATCH, HOLD. Arp notes = held keys; clock-locked. SEND ARP TO MIDI TRACK writes held-note pattern (2 bars) to new MIDI track; CLEAR HELD NOTES.
- Starting pattern while arp on stops the arp (`stopArp` in pattern start).

### Performance
Keyboard (24 keys, OCTAVE select 2-6, pointer+touch, computer keys A-L plus W E T Y U O P ; ' for sharps, global `__glctcKeyOwner` guard), HOLD, STUTTER (retriggers last note every 16th/2), FREEZE (dry to .06, feedback .92 / wet .82), TAPE STOP (filter to 80 Hz in .65 s + dub delay swell; a "dub fall", not pitch), REVERSE SAMPLE, RANDOMISE (cutoff/res/drive/delay/reverb/chorus only), RESET FX.
FX: Overdrive 0-1 (.12), Delay mix 0-.85 (.12), Delay time .04-1 s (.28; not tempo-synced), Feedback 0-.88 (.24), Reverb 0-.8 (.12; generated 2.1 s IR), Chorus 0-.8 (.08; fixed 18 ms static delay - no modulation), Bit crush 0-1 (0; ScriptProcessor bit/rate reducer).

### Sample
LOAD SAMPLE (wav/mp3/ogg/m4a/flac). One sample, pitch-tracked from C4, reversible. Not persisted (settings save drops it; lost on reload/project open).

### Record / export
- REC AUDIO: MediaRecorder on bus output (webm/ogg), STOP RECORD -> adds asset 'GLCTC1 0010110 Synth Performance' + audio track at playhead (quantised 1/4 beat). Records live-time only (not tempo-aligned to transport).
- MIDI REC (labelled "SEND MIDI" in UI, code `startMidiRecord`): creates MIDI track + clip 8 bars long, records played keys with performance.now() timing (live keys only; pattern/arp notes not captured except via 'SEND ARP TO MIDI').
- No offline BOUNCE.
- `＋ CREATE TRACK` has no handler.

### Persistence
`project.s101Settings` (all S except sample); saved with markDirty on every control change; restored per project id. s101Pattern (steps, root, scale, length, gate) is **not** persisted (only via GLCTC_0010110_PATTERNS API). Keyboard octave not saved. Layers' toggles are saved only when other controls call saveSettings (layer edits and enables do not call saveSettings). No patch presets/import/export.

### Clock
Pattern: absolute 16th steps from clock. Arp: beat grid from clock. Delay time, chorus, LFO are free (not synced). `setInterval(...,600)` refreshes tempo text and re-applies FX forever. LOOP LENGTH select (1/2/4/8 bars) exists in toolbar but is not read by any handler (no effect).

### UX pain points (0010110)
1. Loop-length select and Arp swing are dead; CREATE TRACK dead; "SEND MIDI" actually starts a live recording.
2. Layer edits/pattern not persisted; sample lost on reload.
3. Bus filter shared across notes: chords/overlaps retrigger one filter, poly behaviour inconsistent with "mono synth" name; no glide control in pattern; no per-step slide/gate.
4. Delay time not tempo-synced; chorus is static; LFO only hits cutoff weakly; ScriptProcessor deprecated (CPU/glitches).
5. REC AUDIO uses MediaRecorder (compressed webm, real-time, tail clipped, no count-in); no offline bounce for pattern.
6. Pattern uses scale degrees; note labels show only pitch class (no octave) and can't be set directly.
7. No presets at all.

---
## 4. GALACTIC ONE v2 (Jupiter-8-inspired dual-patch polysynth, hub id `go`)

Header comment: dual DCO + sub + noise + ring/x-mod, unison, HPF + 12/24 dB LPF, 2 ADSR, 2 LFOs, 4-slot mod matrix, WHOLE/SPLIT/DUAL key modes, 16-voice poly engine, 32-step sequencer + arpeggiator with probability/ratchet/p-locks, FX rack, macros, audio REC, MIDI REC, offline BOUNCE.

### Patch architecture
Two patches (A/B) edited via EDIT A / EDIT B buttons; each has the same parameters (PD list, ~85 ids). KEY MODE: WHOLE (A only), SPLIT (lower -> B, upper -> A), DUAL (A+B stacked). Voices max = ST.voices (default 14, engine says 16), oldest voice killed when exceeded. Voice mode per patch: POLY, MONO, LEGATO (glide-based retarget).

### Parameters (id, range, default)
- OSC1: WAVE SAW/SQR/PULSE/TRI/SINE (SAW), RANGE 32'-2' (8'), FINE -50..50 ct (0), PW .05-.95 (.5), LEVEL (0.8).
- OSC2: WAVE (SAW), RANGE (8'), SEMI -12..12, FINE -100..100 ct (8), PW, LEVEL (.7).
- SUB 0-1 (.25), SUB WAVE SQR/SINE, NOISE 0-1, COLOR WHITE/PINK, RING MOD 0-1, X-MOD FM 0-1.
- UNISON 1-7 voices (3), DETUNE 0-60 ct (14), WIDTH 0-1 (.8), DRIFT 0-1 (.25).
- FILTER: HPF 20-2000 Hz (20), CUTOFF 30-18000 Hz (5200), RESO 0-1 (.25), DRIVE 0-1 (.1), SLOPE 12/24 dB (24), ENV AMT -1..1 (.45), KEY TRK 0-1 (.5), VEL->CUT 0-1 (.3).
- FILTER ENV (ADSR): A .001-4 s, D .01-5, S 0-1, R .01-6.
- AMP ENV (ADSR): A .001-4, D .01-5, S 0-1, R .01-8; VEL->AMP 0-1 (.5), VOLUME 0-1 (.75).
- LFO1: SHAPE SINE/TRI/SAW/SQR/S&H, RATE .05-30 Hz, SYNC FREE/1/1..1/16T (tempo-synced), DELAY 0-3 s, routes ->PITCH, ->CUTOFF, ->PW, ->AMP (0-1 each), WHEEL->LFO (vibrato depth), WHEEL->CUT.
- LFO2: SHAPE, RATE, SYNC (available only through matrix).
- MOD MATRIX: 4 slots; SOURCE OFF/LFO1/LFO2/ENV1/MOD WHL/VELOCITY/KEY/RANDOM; DEST PITCH/CUTOFF/RESO/PULSE W/AMP/PAN/OSC2 PITCH/X-MOD; AMOUNT -1..1.
- VOICE: MODE POLY/MONO/LEGATO, GLIDE 0-2 s, BEND RANGE 1-12 st (2), ENV->PITCH -12..12 st.

### Global FX rack (shared by both patches, not per patch)
DRIVE, CRUSH (0-1 each), TRANCE GATE rate OFF/1/4/1/8/1/16/1/32 + depth (.9), CHORUS OFF/I/II/I+II + mix, PHASER mix/rate/depth/feedback, DELAY mix/time (1/4,1/8,1/8D,1/16,1/4T,1/8T tempo-synced)/feedback/tone/STEREO or PING-PONG, REVERB mix/size ROOM/HALL/CATHEDRAL/damp, AUTO-PAN rate/depth, STEREO width 0-2 (1.15), OUTPUT 0-1.2 (.85). Final brickwall-ish limiter (-5 dB, 14:1). 4 MACROS: BRIGHT (-1..1, cutoff +/-2400 ct), MOTION, SPACE, GRIT (affect LFO gain, chorus mix, delay/reverb, drive/crush).
Trance gate is tempo-synced (square LFO from bpm). Delay times tempo-synced (re-applied every 300 ms by a poll).

### Presets
36 factory patches with FX (GALACTIC MASSIVE, JUPITER BRASS, JUPITER STRINGS, INFINITE PAD, COSMIC BASS, SUPERNOVA LEAD, POLY KEYS, PWM STRINGS, ACID SEQ, WOBBLE BASS, FM BELL, RING ROBOT, SPACE ORGAN, SYNTHWAVE LEAD, GLASS KEYS, DARK ATMOS, TRANCE GATE PAD, CHOIR AIR, VINTAGE SOLO, NOISE RISER, HOOVER LEAD, ARP PLUCK, CLOUD CHORDS, METAL DRONE, SUNRISE ARP, VELVET BASS, LASER HARP, CATHEDRAL CHOIR, CHROME STAB, LOFI KEYS, WARP PAD, SUB DROP, PIXEL LEAD, AURORA ...). 7 PERFORMANCES (dual/split pairs): BRASS+STRINGS, LEAD/BASS, PAD+PLUCK, KEYS/PAD, MASSIVE+BELL, CHOIR+CHROME, PIXEL LEAD/VELVET BASS. Patch bar: preset dropdown (factory/performance/user), SAVE (prompt name, <=32 chars, stores patch+FX into localStorage `glctc1_galactic_one_user_patches`), DEL (user only), EXPORT (`.go1.json`), IMPORT, RANDOM, INIT, A->B copy, A<->B swap. Loading a factory preset also overwrites the global FX rack.

### Sequencer / arp
- 8 patterns (A-H), 32 steps each, PATTERN LENGTH 4/8/16/32 (default 16). Step fields: on, note n (scale degrees/semitones offset), velocity v (.8), gate g (.6, up to tie ~1.05), probability p (1), ratchet r (1-4+), cut lock c (-1..1 filter p-lock), accent a, slide s. Lane tabs: NOTE, VELOCITY, GATE, PROB, RATCHET, CUT LOCK, ACCENT, SLIDE (bar-graph editing with drag).
- Generators: random, acid, arp, bounce, trance, euclid (k=5), clear. Default pattern A is a demo line; B euclid, C acid, D arp, E bounce, F trance.
- Seq options: mode seq/arp/off, target patch A/B/both, root, scale (12 scales: chromatic, major, minor, dorian, phrygian, lydian, mixolydian, harm minor, minor pent, major pent, blues, whole tone), snap-to-scale, octave (3), direction FORWARD/REVERSE/PING-PONG/RANDOM/DRUNK, swing (0-1, scaled .62), rate (1/8,1/16,1/32,1/8T,1/16T,1/4 = RATE_BEATS), follow (transposes seq from lowest held key), evolve (mutates 2 steps each loop), song CHAIN (list of patterns, chainOn), polymeter LAYER (second pattern with its own position, plays on patch B), arp mode UP, DOWN, UP/DOWN, DOWN/UP, RANDOM, AS PLAYED, CHORD, CONVERGE, arp octaves, LATCH. BARS select (1/2/4/8) for send/bounce length.
- Slide uses glide 75 ms from last note, ratchet subdivides step, step gate scaled.
- Sequencer runs ahead of time by 0.14 s, steps computed from clock beats (resyncs on rate change and catches up on late callbacks). `uiQ` queues UI updates.

### Performance controls
Hold (sustain pedal), PANIC, BEND wheel (goBendWh, +/-1 x bend range), MOD wheel (goModWh), upper/lower keyboards with octave+transpose, velocity default .85, TUNE and voices settings in state, STUTTER (trance gate slices OFF,1/4,1/8,1/16,1/32 injected as momentary gate), TAPE (pitch dive -4800 ct over 1.1 s, release .18 s), hardware MIDI IN (Web MIDI: notes with velocity, CC1 mod wheel, CC64 sustain, pitch bend), computer keyboard (outside this slice), status line, oscilloscope canvas (goScope).

### Record / export
- REC AUDIO: MediaRecorder of rig.out; clip at playhead (quantised 1/4 beat), asset 'GALACTIC ONE Performance'; clip duration derived from decoded length at current bpm.
- REC MIDI: new MIDI track + 8-bar clip; captures live keys (performance.now timing) and sequencer/arp notes (audio-time based); on stop adjusts clip length to max note end rounded up to bar.
- SEND PATTERN -> MIDI: deterministic render of current pattern/chain/layer for BARS bars into new MIDI track 'GALACTIC ONE · Pattern X' (ratchets, gate, swing; probability ignored). ARP mode requires held/latched notes.
- BOUNCE -> TIMELINE: OfflineAudioContext 44.1 kHz stereo, BARS*beats + 4 s tail; builds full rig offline, applies FX; stereo WAV asset + audio track 'GALACTIC ONE · Bounce'. Uses probability (random); respects chain and layer; doesn't include live performance. Disallows SEQ off or ARP without held notes (toast).
- CREATE TRACK: adds empty audio track (cyan #40eaff, volume .8) and selects it; wired (line 2583) - only module in this slice with a working CREATE TRACK.

### Persistence
localStorage `glctc1_galactic_one_v2` (debounced 500 ms, whole state) + `project.galacticOne` (saved with project via markDirty; restored in renderAll at ~2600). User patches in `glctc1_galactic_one_user_patches` (browser-global, not in project). Hub reg `go` includes reset/solo/bypass/send-master (line 2592).

### Sync to clock/timeline
Best integrated of the four: step index derived from `K.timeOfBeat(stepN*rb)`, rate change re-anchors, LFO sync/delay/trance gate follow `bpmNow()` (polled every 300 ms), offline bounce uses the same stepper. Playhead `playheadBeats` used to place recordings/bounces, but sequencer start does not follow the DAW playhead position (uses `__glctcStartStep`), and recorded clips begin at playhead regardless of transport state.

### UX pain points (Galactic One)
1. Huge feature surface (85 params + 8-lane editor) with knob-only editing, no direct numeric entry, no MIDI learn / parameter automation lanes (no way to record knob moves to the timeline).
2. Global FX shared by A/B; loading a patch silently replaces FX settings; user patches are browser-global.
3. Patch bar is crowded (EDIT A/B, KEYS, preset, SAVE, DEL, EXPORT, IMPORT, RANDOM, INIT, A->B, A<->B on one row); presets dropdown mixes 3 kinds in optgroups.
4. SEND MIDI ignores probability while BOUNCE honours it (inconsistent).
5. Sequencer cannot be recorded in real time with step entry from keyboard; pattern play start position does not follow the timeline playhead.
6. Hold button state saved but sustainOn may desync after reload (hold sets ST.hold, runtime var not restored from state before first key).
7. ArpMode CHORD returns up to 6 notes; mono/legato per-patch only; voices cap UI not located in this slice.
8. 24-key limits and octave switching are in the remainder of the module (outside slice).

---
## Cross-module summary (parity gaps visible in this slice)
| Capability | DIVINE09 | 30LEE | 0010110 | GALACTIC ONE |
|---|---|---|---|---|
| Presets / patch save | kit JSON only | none | none | 36 factory + 7 perf + user + import/export |
| Pattern banks | 4 x 128 steps | 4 x 16 | 1 x 16 | 8 x 32 + chain + layer |
| Per-step velocity edit | no | no | no (accent only) | yes (lanes) |
| Probability/ratchet | no | global prob | no | per-step |
| Arp | no | yes (pattern notes) | yes (held keys) | yes (8 modes) |
| Live keyboard / MIDI in | pads only | 13 keys | 24 keys + QWERTY | 2 keyboards + Web MIDI + QWERTY |
| Audio rec | no | no | yes (MediaRecorder) | yes |
| MIDI rec / export | no | no | live only + arp | live + pattern |
| Offline bounce | no | yes (random prob) | no | yes |
| Project persistence | no (localStorage only) | yes (+ unused LS) | settings only | yes (project + LS) |
| CREATE TRACK button works | NO | NO | NO | yes |
| Per-instrument mixer/automation | per-channel mixer only | none | none | none (macros only) |
Dead/stub controls found: Divine09, 30LEE and 0010110 CREATE TRACK; 0010110 LOOP LENGTH select and arp SWING; 30LEE stereo width; 30LEE FILTER FREEZE restore; localStorage `glctc1_30lee_preset` write-only.
