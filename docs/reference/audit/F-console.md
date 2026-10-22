# F-console: daw.html lines 4048-4813 (read-only audit)

SCOPE NOTE: this slice holds three things, not a master console / mixer / headphones / booth / solo-play UI:
1. Instrument Preset Libraries (L4048-4205), 2. Song Composer v2 (L4206-4780, includes AI pattern generator), 3. Action Sequencer (L4781-4813).
Master console, headphones, booth, bypass UI, keyboard shortcuts, mixer routing are NOT defined here; this slice only CONSUMES them (see Cross-cutting). Those must come from other slices (script blocks at L766 and L791, or earlier HTML).
No instructions were found embedded in the file content.

## 1. Instrument Preset Libraries (L4048-4205)
Storage: `glctc1.instrumentPresetLibraries.v2` (localStorage, {moduleKey:{factory:{},user:{}}}); marker `glctc1.divine09.factoryVoicingVersion`='2'.
Modules (6 preset bars mounted, `.gpc-bar` under each panel title): lp (LOOPER, `looper` of selected `#lpTrack`), bl (80LA8 DRUMS), mine (DIVINE09), lee (30LEE ACID), s101 (0010110 SYNTH), ws (PAD-64 mods + slots/bars/swing/tool). No preset bar for GALACTIC ONE / VOX (they use their own selects: `goPreset` 'F|' patches, `voxType`).
Capabilities:
- Preset dropdown with FACTORY / USER optgroups; selecting an entry auto-loads it; also SAVE PRESET (window.prompt name, trimmed to 48 chars), LOAD PRESET, DELETE (confirm; user only; factory delete refused with status text); per-panel status line.
- Factory sets: ~1-6 base factory presets per module + 6 genre packs each (Techno, House, DnB, Hip-Hop, Ambient, Pop) for bl, mine (+Electro 606, Glitch hybrid), lee, s101, ws, lp. DIVINE09 has per-voice level/pan/tone/reverb/delay "tuneMine" balancing and per-style voice profiles.
- Presets are sound-only: patterns are stripped (`slim`) to avoid filling the 5 MB quota; audio buffers never serialised. One-time migration strips old pattern data.
- Fires `glctc1-presets-changed` (Song Composer grid re-renders). Exposes `window.GLCTC_PRESET_LIBRARIES={load,save,options,adapters}`.
Bugs / pain points:
- Factory presets are stored in localStorage and seeded ONLY when a module's factory set is empty. Newly added factory presets (e.g. the genre packs the Song Composer GENRE table depends on, like 'Techno · Warehouse Kit') never appear for users whose v2 library was seeded earlier; only DIVINE09 has a versioned refresh. The composer silently skips a preset name that is missing (applyPresets checks option exists).
- Factory presets are built by cloning the module's CURRENT state at first seed then mutating, so "Factory · Studio Kit" and every unmentioned param reflect whatever the user had at that moment, not true defaults.
- User preset with same name as a factory preset silently shadows it on load (user checked first) and overwrites an existing user preset with no overwrite confirm.
- Naming/delete use window.prompt/confirm; no rename, no duplicate, no export/import of presets to file, no sharing between projects/devices.
- Auto-load on dropdown change makes LOAD PRESET redundant and risks accidental overwrite of tweaks (no undo).
- LP preset stored with trackId; load falls back to the current track if the id is missing (can apply to wrong track).
- write() returns false on quota but factory seeding ignores it silently.

## 2. Song Composer v2 (L4206-4780)
Persistence: `glctc1.songcomposer.v2` = {bpm,len,loop,secs[{n,kind,bars}],cells{mod:[pattern idx per section]},on{},level{},presets{}}. Load validation: len must be in TPL, secs array, every module cells array length === secs length; bpm clamped 30-300; section name sliced 12; bars coerced to 8 else 4. Not validated: cell values (range/NaN/>module pattern count), kind, level values, preset names.
UI (panel `#glctc1SongComposer`, inserted after `#wsPanel`):
- Prompt textarea ("DESCRIBE YOUR TRACK"), GENRE (Techno, Deep/Tribal House, Jungle/DnB, Hip Hop, Meditation/Ambient, Pop/Electronic), AI->MASTER BPM read-only display (master `#bpm` is the only tempo), LENGTH (Demo 36 bars, 16, 32, 64), LOOP SONG, AI-WRITE PATTERNS checkbox.
- Grid: rows = 8 modules (LOOPER, 80LA8 DRUMS, DIVINE09, 30LEE ACID, 0010110 SYNTH, GALACTIC ONE, GALACTIC VOX, PAD-64); per-row include checkbox, preset select ("keep current" or module presets; GO shows only 'F|' factory patches), LEVEL slider 0-100 (not for LOOPER), one select per section: "-" (fade out) or pattern A-D / A-H / ON. Per-section bar length select (4 or 8). Current section highlighted (`.gsc-now`), live status "SECTION n/N - name - BAR x/y - BPM".
- Templates: demo (INTRO, BUILD, DROP 1, BREAK, BUILD 2, DROP 2, OUTRO = 36 bars, 130 BPM C minor), 16, 32, 64 bar layouts. Fixed section kinds: intro/build/drop/break/outro.
- Buttons: GENERATE SONG & PLAY; PLAY SONG (toggles STOP SONG; a second PLAY SONG button `songPlayBtn` is injected after `playAllModulesBtn`); FILL PATTERNS (NO PLAY); RESTORE MY PATTERNS; AUTO-ARRANGE (NO PLAY); LOAD DEMO SONG; ADD YOUR AUDIO / SAMPLES (clicks `#importAudio`); BOUNCE MIX (WAV); EXPORT SONG (WAV).
- Disabled while playing: LENGTH, AUTO-ARRANGE, DEMO, GENRE, per-section bar selects. Editable live: cell selects, include checkbox, level slider ("future bars only").
Behaviour:
- Conductor: startSong sets master BPM from `#bpm` (clamped), `hub.stopAll()`, `reanchorBpm()`, resumes AudioContext, ensures buses, warms GALACTIC VOX (6 s race timeout) and GALACTIC ONE rig, applies presets once, forces DIVINE09 bars to 4 if >4, steps through GO pattern buttons to read their lengths, builds GO chain string (cap 900 chars) and enables CHAIN PATTERNS, starts at `ctx.currentTime+0.4`, sets shared clock `hub.sharedEpochAt/sharedBeat/sharedBpm`, launches every included, non-bypassed module with `h.launch(mod,t0,0,true,false)`, and starts `glctcTimeline.startAt(t0,0)`.
- 10 ms setInterval tick: boundary lookahead 0.45 s; per module bus gain fades scheduled on the bar line (12 ms fade, 1 s tail fade at end); pattern switch inside last step before bar line (per-module lookahead 0.06-0.14 s); LOOPER has no bus so it is launched/halted on bar line; loop mode realigns timeline each cycle; end: "SONG FINISHED" 1.2 s after last boundary; auto-stop if all launched modules stopped; any exception stops safely with console log.
- stopSong resets all bus gains to 1, `hub.stopAll()`, clears shared epoch, halts timeline, restores GO chain/checkbox.
- Master BPM change during play is followed (tempo-synced via GLCTC_CLOCK beats).
- Shared clock: GLCTC_CLOCK.beatAt/timeOfBeat/bpm/fmt; GLCTC_HUB sharedEpochAt/sharedBeat/sharedBpm/playAllActive; composer disables `playAllModulesBtn` while song plays.
AI pattern generator (`window.GLCTC_PATTERNS`, keyword heuristics, not a model):
- 6 genre definitions with 4 pattern kinds (main, alt/drop-2, breakdown, build/fill); writes to 80LA8, DIVINE09, 30LEE, 0010110, GALACTIC ONE (8 patterns), VOX, PAD-64 via `GLCTC_*_PATTERNS` APIs; key chosen from genre key list; scale from prompt words (major/happy/bright/uplift/euphor; phrygian/spook/dark/menac; minor/sad/melanch).
- Prompt keywords: acid/303 re-enable lee; vocal/vox/choir/sing/voice re-enable vox; "no drums/without drums/drumless" skips bl, mine, ws, lp; "minimal" skips s101, vox, ws. Genre default skips: dnb skips vox; hiphop skips s101, ws; ambient skips lp, bl, mine, lee, ws.
- Tempo: explicit "NNN bpm"/"tempo of NNN" in prompt wins; else genre default (techno 130, house 124, dnb 174, hiphop 90, ambient 80, pop 118); applied only on GENERATE; dispatches input+change on `#bpm`.
- Backup/restore: first fill snapshots all module patterns; RESTORE MY PATTERNS puts them back (in-memory only).
- Status line shows key, module count and seed.
Bugs / pain points:
- BOUNCE MIX (WAV) and EXPORT SONG (WAV) call the same `GLCTC_WS.exportWav()` of the MAIN TIMELINE, which the composer explicitly does not write to. Neither exports the composed song. Duplicate, misleading buttons (the note admits "render the main timeline, as before").
- setInterval(10 ms) scheduler is throttled in hidden/background tabs (browsers clamp to >=1 s); with a 0.45 s lookahead, bar-line gain and pattern switches will be missed or late when the tab loses focus.
- "AI" label is keyword matching; seed includes Date.now(), so the displayed seed cannot reproduce a result; no way to enter a seed or re-roll a single module.
- Backup is taken once per session at first fill; later fills do not update it; RESTORE overwrites any manual edits made after the first fill and is lost on reload.
- GENERATE replaces sections, cells, include flags and presets with no undo (only patterns are restorable) and saves immediately.
- Sections are fixed templates: cannot add/remove/reorder/rename sections, only 4 or 8 bars each; no per-section tempo, no arrangement beyond one pattern per module per section.
- `st.bpm` is a mirror of `#bpm`; stored/loaded value may be stale (title length estimate uses st.bpm); changing genre alone stores `#bpm`.
- Bypass is checked only at start (`h.bypassed(mod)`); bypassing/un-bypassing mid-song is not handled.
- Level slider uses `setGainNow` with `cancelScheduledValues(0)`, wiping any scheduled bar-line ramp (possible click or lost fade).
- Startup side effects mutate user settings without restoring them: DIVINE09 bars forced to 4, GALACTIC ONE length coerced and pattern buttons clicked, preset selects changed (presets apply once at start overriding user tweaks).
- Corrupt localStorage cells (out-of-range/NaN) pass validation and can select nonexistent patterns.
- Grid is a min-width 760 px table with horizontal scroll; 8 rows x N sections of tiny selects; pattern labels A-H only; no solo/mute per module or per section in the grid (a "-" cell is the only mute).
- Lots of silent `catch(e){}`; missing GLCTC_WSBUS bus means level control silently does nothing.

## 3. Action Sequencer (L4781-4813) - root `#glctc1ActionSequencer`
Persistence: `glctc1.action-sequencer.v1` = {version:1,events,layer}. "Armed" is NOT persisted.
UI ids: asArm, asRecord, asStop, asPlay, asNewLayer, asClear, asExport, asImport (+hidden asFile), asSnap (quantize grid), asState, asLanes.
Capabilities:
- ARM ACTIONS toggle (must be armed before RECORD, else "ARM ACTIONS FIRST"). RECORD toggles; STOP stops record+playback; PLAY toggles replay; NEW LAYER increments layer tag; CLEAR (confirm) wipes all events and resets layer to 1; EXPORT JSON file `GLCTC1-Recorded-Take.json` ({app:'GLCTC1 ACTION SEQUENCER',version:1,bpm,events,layer}); IMPORT JSON.
- Recorded: capture-phase document listeners for `input` on range sliders, `change` on checkbox/select, and `click` on buttons/pads/steps/keys ([role=button], .pad, .bl-pad, .mine909-pad/-step, .bl-step, .lee303-key, .s101-key, .s101-pattern-step), only inside #wsPanel, #beatLabPanel, #mine909Panel, #lee303Panel, #s101Panel, #galacticOnePanel, #voxPanel, #looperPanel, or `.panel.mixer`.
- Capture denylist: element must have an id (except peer-indexed clicks) and not be asRecord/asStop/asPlay/asArm/asClear/asExport/asImport/asNewLayer/asFile/asSnap/bpm/projectName or an id starting save/load/clear/delete/reset/export/import/record/play/stop/toStart/modulesBtn/playAllModulesBtn/resetAllModulesBtn/midiLearnBtn; clicks also skip ids containing mute|solo|bypass|sendMaster|stutter|freeze|tape|panic|reset|clear|delete|stop|play|record|export|import. So mute/solo/bypass/send-to-master are intentionally NOT recorded.
- Event model: {id, selector (`#id` or `modId::perf:<index>` among that module's buttons/pads), kind click|input, value, beat (snapped to asSnap, min 0.125), layer, name (aria-label/title/text, 60), tag, cls}.
- Beat from transport "position" text `bar:beat:ticks` (ticks/960) with `timeSig` numerator.
- Lane view: one row per layer, block per event positioned by beat/max(16, last beat+1); click block -> confirm delete; hover title "Bar n - name - tap to remove".
- Replay: events sorted by beat, fired via `.click()` or setting value + dispatching input and change; playback ends with "PLAYBACK COMPLETE".
- Import validation: version===1, events array <=20000; each event needs finite beat>=0, kind in {click,input}, string selector; fields clamped (selector 300, beat <=100000, layer 1-100, name 60, value only string/number/boolean else null). Confirm dialog before replacing the current take. Error -> "IMPORT FAILED" + alert. File input reset afterwards.
Bugs / pain points:
- PLAYBACK TIMING BUG: each event's `delay=(ev.beat-base)*msPerBeat` is absolute from the first event, but each setTimeout is started only after the previous one fires, so delays accumulate (event n fires at the sum of offsets 1..n). Replay is stretched and drifts progressively.
- Replay uses setTimeout, not the shared clock or transport: not synced to the song/playhead, no loop, no count-in, ignores later BPM changes, jitter in background tabs; first event is always at t=0 (leading silence removed); `takeStart` is stored but never used.
- Beat capture reads the position text; while transport is stopped (or the song composer/module play-all runs without the main transport) the position is static, so events stack on the same beat.
- Layers are only tags: no per-layer mute/solo/clear/overdub-replace; playback merges all layers.
- REPLAY BYPASSES THE CAPTURE DENYLIST (security/safety): `fire` resolves `ev.id` (any DOM id string, only type-checked on import) or `mod::perf:n` and calls `.click()` or sets values on it. A crafted JSON take can click any element on the page (delete, reset, export, import, save) and change any control (including `bpm`, `projectName`). Selector and id are not cross-checked or restricted on import; localStorage load validation is weaker still (no beat cap, no name slice, no layer clamp).
- Capture: `input` fires for every slider movement tick with no coalescing/throttle, so one drag creates dozens of events that quickly fill the lane and the storage; no 20000 cap while recording.
- Range/select/checkbox without an id are silently dropped (peer-index fallback only enumerates buttons, so ix=-1), so unlabelled controls cannot be recorded. Peer-index selectors are fragile if the DOM changes.
- Only module panels and `.panel.mixer` are captured: no master console, transport, or timeline controls, and no note input from keyboards/MIDI/pads that are not DOM clicks.
- STOP always runs stopRec, showing "TAKE SAVED - n EVENTS" even when nothing was recording.
- No event editing (move, change value, quantise after recording), only one-by-one delete via confirm; lane blocks overlap with long labels; quantise grid only applied at record time.
- Export includes bpm but import ignores it (a take recorded at one tempo plays at the current tempo). Import replaces the take entirely, no merge.
- save() runs on every captured event (JSON.stringify of whole list) - O(n^2) during slider drags.
- Replay fires `input` and `change` for each value event; mixers with both handlers can double-apply.

## Cross-cutting
- Persistence keys: glctc1.instrumentPresetLibraries.v2; glctc1.divine09.factoryVoicingVersion; glctc1.songcomposer.v2; glctc1.action-sequencer.v1. All localStorage, all wrapped in try/catch; no cross-device/project export for presets or composer state. Preset library plus composer plus action events share the ~5 MB origin quota with project data (comment in code confirms quota was already hit once).
- Globals exported: GLCTC_PRESET_LIBRARIES, GLCTC_PATTERNS, GLCTC_SONG {play,generate,stop,state,running}, GLCTC_SONG_PATTERN_KEY.
- Globals consumed (defined elsewhere, audit those slices): GLCTC_WS (proj, state, markDirty, applyPresetState, ac, ensureBuses, exportWav, pstate), GLCTC_WSBUS(modKey).gain (per-module mixer bus), GLCTC_HUB {mods, launch, halt, stopAll, reanchorBpm, bypassed(mod), sharedEpochAt/Beat/Bpm, playAllActive, syncTempoDisplays}, GLCTC_CLOCK {bpm, beatAt, timeOfBeat, fmt}, glctcTimeline {startAt, halt, realign}, module APIs GLCTC_80LA8_/DIVINE09_/30LEE_/0010110_PRESET and _PATTERNS, GLCTC_PAD64_PATTERNS/INPUT, GALACTIC_ONE (getRig, patterns), GALACTIC_VOX (ensure, patterns). Element dependencies by id: bpm, lpTrack, importAudio, playAllModulesBtn, goChain, goLen, mine909Bars, mine909Pattern, blPattern, lee303Pattern, goPreset, voxType, position, timeSig.
- Keyboard shortcuts: NONE in this slice. Nothing handles keydown; the composer and sequencer are mouse/touch only (buttons have `touch-action:manipulation`, min-height 40 px).
- Accessibility: composer status uses role=status; preset select has aria-label; many tiny 11 px/10 px labels; icon glyph buttons without aria; sequencer lane blocks are buttons but have no keyboard-accessible edit.
- Headphones/booth/solo-play/master console: not in lines 4048-4813. The only related hooks: bypass check at song start, per-module bus gain (the mixer), shared clock/epoch. The action sequencer deliberately excludes mute/solo/bypass/sendMaster from capture.
