# daw.html slice A (lines 1-765): CSS + static HTML markup inventory
Source: /Users/mikelsulanjaku/Projects/Active/GLCTC1Music/daw.html. Title "GLCTC1 MUSIC - DAW v29 Live Chain". Read-only audit.

IMPORTANT scope note: three big panels are EMPTY MOUNT POINTS in this slice, filled by JS (outside slice, lines 766+): `#goApp` (GALACTIC ONE), `#voxApp` (GALACTIC VOX), `#wsApp` (Master Console). Also JS-generated: mixer strips, track rows, pads, step grids, per-module knob/slider controls (`#s101MainControls`, `#lee303SynthControls`, etc.), `.mod-toggle` collapse bars, `#modalRoot` dialogs, `#toast`. Only class hints from CSS are listed for those; the JS slice auditors must supply the real control lists.

## 0. Global chrome
- Theme: dark, gold (#ffd36a) accent; vars --blue/--purple/--green/--orange/--red. Meta theme-color #08090c, viewport-fit=cover (notch safe).
- Brand bar: "GLCTC1 MUSIC" / tagline "CREATE - MIX - SEQUENCE - VISUALISE"; right text "I AM GALACTIC ONE" (`.brand-right`, hidden <=850px).
- Site nav (links): index.html ACCESS, library.html LIBRARY, decks.html DECKS, daw.html DAW (current), social.html SOCIAL, radio.html RADIO, booking.html BOOKING, shop.html SHOP.
- `#toast` (transient message), `#modalRoot` (JS modal host).
- Hidden file inputs: `#audioFiles` (audio/video mp4/mov/webm, multiple), `#videoFiles`, `#imageFiles` (png jpg gif webp svg avif), `#projectFile` (.glctc1/.json).
- Hidden audio sinks: `#hpAudio`, `#boothAudio` (headphone / booth output routing via setSinkId-style).
- Touch behaviour comment: no Android long-press menus/text selection on controls (user-select none, touch-action manipulation on pads, `#trimBar` touch-action none).
- Module collapse system (CSS "NEON MODULE COLLAPSE BARS", JS-injected): `.mod-toggle` bar per module with `.mt-name`, `.mt-run` (green running indicator), `.mt-act` pill (action label, changes colour when collapsed); `.mod-collapsed` hides everything but the bar; `.mod-allbar` row of full-width buttons (expand/collapse all style, min 44px).

## 1. Project bar (top of `<main class="app">`, two rows, `.projectbar`)
Row 1 (`.footer.projectbar`):
- `#projectName` text field "Untitled Galactic Project" (aria: Project name)
- `#saveProjectFooter` "Save" (primary) - save to device
- `#loadProject` "Open Saved"
- `#clearProject` "Clear Arrangement" (danger)
- hint: "Projects saved on this device - GLCTC1 MUSIC - I AM GALACTIC ONE"
Row 2 (label EXPORT):
- `#saveProject` "Save Locally" (primary)
- `#exportAudio` "Export Mix (WAV)"
- `#exportProjectBottom` "Download Project"
- hint: "WAV renders MIDI, audio clips and video audio."

## 2. Toolbar / transport (`section.toolbar`)
Transport buttons (`.transport`):
- `#toStart` |<  go to start; `#playBtn` play/pause (primary); `#stopBtn` stop; `#loopBtn` loop on/off; `#recordBtn` record from microphone
- `#modulesBtn` "MODULES ON" - master transport starts all modules that have PLAY WITH MASTER on; off = timeline only
- `#playAllModulesBtn` "PLAY ALL MODULES" - start all modules together in time; press again stops all
- `#resetAllModulesBtn` "RESET ALL MODULES" (danger) - factory settings / demo song for every module
- `#midiLearnBtn` "MIDI LEARN OFF" - arm MIDI learn: touch a control, then move a hardware MIDI control
Other:
- `#metronome` checkbox CLICK
- `#bpm` number 30-300 step 0.1 default 130 (gold, large)
- `#timeSig` select 4/4, 3/4, 6/8, 5/4 (label TIME SIGNATURE)
- `#position` readout BAR:BEAT:TICK (1:1:000); `#clock` readout MIN:SEC:MS (00:00:000)
- `#snap` checkbox Snap (default on); `#grid` select 1/16 (0.25), 1/8 (0.5), 1/4 (1), 1/32 (0.125)
- `#status` role=status text "Ready - local project"
- Mobile: <=850 reduced toolbar/metric padding; <=480 status goes full width, transport buttons min 34px.

## 3. Browser panel (left aside "SOUND & MEDIA BROWSER") 
Search: `#assetSearch` "Search imported media..." (global to tabs).
Tabs (`.browser-tabs`, data-tab): AUDIO (default), MIDI, VIDEO, IMAGE, PROJECT, PLUGINS. (CSS at <=850px sets 5-col tabs grid although 6 tabs exist - possible wrap/overflow quirk to check.)
- AUDIO (`#browserAudio`): hint on auto BPM + key detection (also for MP4 audio); `#importAudio` Import Audio; `#addSynth` Add Synth Track; `#addAudioTrack2` Add Audio Track; asset list `#audioAssets`.
- MIDI (`#browserMidi`): `#addMidi` Add MIDI Track; `#openPiano` Open Piano Roll (see 5c).
- VIDEO (`#browserVideo`): `#importVideo`; `#addVideoTrack2`; list `#videoAssets`.
- IMAGE (`#browserImage`): `#importImage`; `#addImageTrack` "Add Video Track" (images show on visual stage for clip duration); list `#imageAssets`.
- PROJECT (`#browserProject`): `#newProject`; `#openProject` Open Project File; `#exportProject` Export Project Package; list `#savedProjects` (local saves). Hint: projects stored in this browser.
- PLUGINS (`#browserPlugins`): `#addInstTrack` Add Instrument Track; `#loadPlugin` Load Plugin (VST/AU/WAM); `#wamUrl` paste plugin URL + Enter; hidden `#wamSdk`; `#plugMidi` Enable MIDI Input + `#plugMidiSt` status "MIDI off"; hidden `#plugFile` (.js .mjs .vst .vst3 .component .dll .au, multiple); saved plugin list `#wamSaved`; dynamic plugin UI host `#plugDyn`. Hint: built-ins always work; WAM loads from file/URL; native VST/AU can't run in a browser.
- Asset cards (`.asset` in `.library-list`) are JS-rendered; list grid 2 cols <=850, 1 col <=480.

## 4. Arrangement / timeline panel
Header buttons (`.timeline-head`): `#addAudioTrack` Audio Track; `#addVideoTrack` Video Track; `#autoTarget` select FX automation target; `#addAuto` FX Automation; `#addAutoObj` FX Object; `#undoBtn` (Ctrl+Z); `#redoBtn` (Ctrl+Y); `#zoomOut`; `#zoomIn`; `#deleteClip` Delete Clip (danger).
Body: `#timelineScroll` > `#timeline` with ruler (`#rulerGrid`), `#trackRows` (JS rows with `.track-label`), `#playhead`.
Mobile: `.mobile-note` "Swipe horizontally... Select a clip to edit it." shown <=850; timeline-scroll max-height 480; <=480 track label 170px, 18px/beat.

## 5. Object editor panel (lower-left; title `#editorTitle` OBJECT EDITOR, `#selectedInfo` "No clip selected")
a) Clip fields: `#clipName`, `#clipStart` (bars, step .25), `#clipLength` (bars).
b) Edit row: `#edUndo`, `#edRedo`, `#edZoomOut`, `#edZoomIn`, `#edFit`, `#objCut` (Ctrl+X), `#objCopy` (Ctrl+C), `#objPaste` (Ctrl+V, at playhead), `#objDel`.
c) Sample row `#sampleRow` (hidden until audio clip selected): chips `#detBpm` ("-- BPM"), `#detKey` ("Key: --"); `#useBpm` Set project BPM; `#bpmHalf` (1/2x); `#bpmDouble` (2x); `#clipPitch` -12..+12 st (`#pitchVal`); `#clipFine` -50..+50 ct (`#fineVal`); `#clipWarp` checkbox Sync tempo to project BPM; `#clipKeyLock` Key lock; `#pitchReset`; `#pitchInfo` text.
d) Waveform: `#edScroll` > `#edInner` with `#waveCanvas` (900x150), selection overlay `#edSel`, head `#edHead`.
e) Trim bar `#trimWrap` (hidden by default): `#trimBar`/`#trimCanvas`, dim masks `#trimDimL/R`, selection `#trimSel`, drag handles `#trimL` (set clip start) and `#trimR` (set clip end), `#trimInfo`.
f) Clip actions: `#splitClip` Split at Playhead; `#duplicateClip`; `#trimStart` Trim to Playhead; `#fadeIn`; `#fadeOut`; `#cutOut` Cut Out Selection; `#keepSel` Keep Selection; `#clipGain` slider 0-2.
g) Track Mixer box `#trackMixerBox` (hidden unless a track selected): header "TRACK MIXER - FX", `#trackMixerName`, content `#trackMixer` (JS: per-track FX).
h) Automation row `#autoRow` (hidden): `#autoTarget2` FX target; `#autoShape` preset shape (Draw by hand, Flat, Ramp up, Ramp down, Triangle, Sine LFO, Saw); `#autoLinks` link area.
i) `#edInfo` hint text.
j) Piano roll `#pianoPanel` (hidden; opened via Open Piano Roll): "PIANO ROLL - SELECT MIDI TRACK", `#pianoTrack` select, `#pianoRoll` grid (tap cells to add/remove notes; rows = pitch; columns follow grid; simple built-in synth; max-height 230 scroll).

## 6. Galactic Visual Stage panel
Title GALACTIC VISUAL STAGE with `#videoTime` (00:00). Buttons: `data-stage="wide"` Widescreen 16:9; `data-stage="phone"` Full Phone 9:16; `#stageFull` Fullscreen. Preview area `#videoPreview` (placeholder "Select a video clip to preview it here"; images/video render here). `#previewPlay` Preview. Hint: preview follows playhead when possible.

## 7. Action Sequencer (`#glctc1ActionSequencer`, "ACTION SEQUENCER / RECORDED SPACE")
`#asState` status "READY - NOT RECORDING". Tools: `#asArm` ARM ACTIONS; `#asRecord` RECORD TAKE; `#asStop` STOP/FINISH; `#asPlay` PLAY ARRANGEMENT; `#asNewLayer` NEW LAYER; `#asExport` EXPORT TAKE JSON; `#asImport` IMPORT TAKE JSON (hidden `#asFile` .json); `#asClear` CLEAR RECORDED SPACE; `#asSnap` select 1/16, 1/8, 1/4, 1/2. Ruler BAR 1/5/9/13/17; lanes `#asLanes` (empty message "Arm actions, then record supported controls"). Captures module/mixer control values and pad/key actions; stored locally; imported JSON validated. Mobile <=600: lane columns 100px + min 460px, tool buttons flex 42%.

## 8. Master Mixer (`section.mixer`)
- Strips `#mixStrips` (JS: one channel per track; send to master, headphones, booth per subtitle). Strip class `.mstrip`, `.mstrip.tr` widths 172/180px; `.mix-grid` 2 cols <=850.
- MASTER strip: `#mtL`/`#mtR` meters, `#masterVol` 0-1, `#mClip` CLIP latch (tap to reset), `#mDb` dB readout, `#masterValue` %.
- MASTER FX box: `#mfxOn` FX OFF toggle; `data-mfx` buttons flt FILTER, dly DELAY, rev REVERB; `#filterCutoff` (200-18000) `#filterValue`; `#delayMix` (0-.65) `#delayValue`; `#reverbMix` (0-.8) `#reverbValue`.
- HEADPHONES box: `#hpVol`; `#hpDev` output device select; `#hpMix` Monitor master in HP. BOOTH OUT: `#boothVol`; `#boothDev`; `#outDetect` Detect output devices.

## 9. Sampler / Looper Pads (`#looperPanel`)
Header: `#lpTrack` target track select; `#lpCreate` CREATE TRACK; `#lpTempo` readout BPM. Body: `#lpPads` pad grid (4 cols, 8 cols >=768); `#lpWave` waveform canvas; buttons `#lpRec` REC; `#lpPlay` PAD (audition, unsynced); `#lpTransportPlay` PLAY PATTERN; `#lpSolo` SOLO PLAY; `#lpTransportStop`; `#lpTransportLength` 1/2/4/8 bars; `#lpSendMaster` PLAY WITH MASTER; `#lpBypass` BYPASS; `#lpLoop`; `#lpRev` REVERSE; `#lpHalf` 1/2x; `#lpDbl` 2x; `#lpLoad` Load sample (hidden `#lpFile` audio); `#lpClear`; `#lpBounce` Bounce -> Timeline. Row 2: `#lpMode` (Toggle loop / One-shot / Gate hold); `#lpBars` record length (Tap to stop, 1, 2, 4, 8 bars); `#lpWarp` Fit loop to project tempo. `#lpSliders` per-pad sliders (JS, `.lpgrid`); `#lpInfo`.

## 10. GLCTC1 80LA8 drum machine (`#beatLabPanel`)
Head: `#blTempo`, `#blTapTempo` TAP TEMPO. Toolbar: `#blCreateTrack`, `#blPlay`, `#blSolo`, `#blStop`, `#blSendMaster`, `#blBypass`, `#blPattern` (A Main, B Variation, C Break, D Fill), `#blBars` 1/2/4/8, `#blKeyLockAll` Key Lock, `#blClear`, `#blFill` Euclidean Fill, `#blRandom` Randomise, `#blBounce` Bounce -> Timeline.
Sections: STEP SEQUENCER 16 STEPS (`#blSteps`; `#blSwing` 0-.6 + `#blSwingVal`; `#blVelocity` selected-step velocity + `#blVelocityVal`; tap step to toggle, select to edit velocity; swipe on mobile, steps min-width 690 <=700). LIVE TAP PADS (`#blPads`). PER-SOUND MIXER & FX RACK (`#blVoiceTitle` "KICK - SOUND 01", `#blVoiceList` voice select, `#blFx` rack: level, pan, pitch, decay, tone, overdrive, delay, reverb per sound; `#blMeter`). All sounds synthesised in Web Audio.

## 11. GLCTC1 Divine09 / 90MINE 909 drum (`#mine909Panel`, class mine909 divine09)
Head: `#mine909Tempo`, `#mine909Status` "909 ENGINE READY". Toolbar: `#mine909CreateTrack`, `#mine909Play`, `#mine909Solo`, `#mine909Stop`, `#mine909SendMaster`, `#mine909Bypass`, `#mine909Pattern` (A Club Driver, B Warehouse, C Broken Beat, D Fill/Chaos), `#mine909Bars` 1/2/4/8, `#d09EditBar` BAR 1-8, `#d09Kit` (909 punch, 808 deep, 606 bright, 707 digital, Linn-style, DMX snap, Electro, Industrial, Tribal, Breaks, Glitch, Hybrid), `#mine909Swing`/`#mine909SwingVal`, `#mine909Random`, `#mine909Clear`.
Tools: `#d09CopyBar` COPY BAR->NEXT, `#d09Euclid`, `#d09Half` HALF-TIME, `#d09Double` DOUBLE-TIME, `#d09Reverse` REVERSE BAR, `#d09SaveKit` SAVE KIT JSON, `#d09LoadKitBtn` LOAD KIT JSON (hidden `#d09LoadKit`). Grid `#mine909Steps` (velocity accents). VOICE DESIGNER `#d09VoiceProfiles` (choose sound per channel). FOUR EXTRA SAMPLE CHANNELS `#d09Samples` (samples persisted in browser; kit JSON excludes audio). LIVE DRUM PADS `#mine909Pads`. Mix sliders: `#mine909Level` MASTER LEVEL, `#mine909Drive`, `#mine909Room` ROOM/REVERB, `#mine909Hat` HAT TONE, `#d09Bit` BITCRUSH, `#d09Filter` FILTER SWEEP, `#d09Stutter` STUTTER OFF toggle. Instruments: kick, snare, clap, closed/open hats, low/mid/high toms, rim, ride, crash. Note the `bounce`-to-timeline is absent here (80LA8/30LEE/looper have it).

## 12. GLCTC1 30LEE acid bass (`#lee303Panel`)
Head: `#lee303Status` "ACID ENGINE READY", badge "MONO - RESONANT - WILD". Toolbar: `#lee303Play`, `#lee303Solo`, `#lee303Stop`, `#lee303SendMaster`, `#lee303Bypass`, `#lee303Pattern` (A Acid Line, B Rave Push, C Broken Signal, D Chaos Fill), `#lee303Scale` (Minor, Major, Phrygian, Dorian, Pentatonic, Chromatic), `#lee303Octave` 1-4, `#lee303Random` ACID GENERATOR, `#lee303Clear`, `#lee303Bounce`.
Cards: (1) ARPEGGIATOR: `#lee303CreateTrack`, `#lee303ArpToggle` ARP OFF, `#lee303ArpMode` (Up, Down, Up/Down, Pattern order, Random), `#lee303ArpRate` (1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32), `#lee303ArpOct` 1-4, `#lee303ArpGate` + val. (2) 16-STEP ACID SEQUENCER `#lee303Steps` (tap toggle, SHIFT-tap = accent, RIGHT-CLICK = slide); `#lee303TempoVal` (locked to DAW BPM), `#lee303Swing`, `#lee303Gate`, `#lee303Length` 8/16, `#lee303TransportLength` 1/2/4/8. (3) DEVIL FISH MODS `#lee303SynthControls` (JS knobs: cutoff, resonance etc.). (4) LIVE KEYBOARD `#lee303Keyboard` (13-key, scrolls on mobile); `#lee303Note` (selected step note, 24-60), `#lee303Accent`, `#lee303Slide` (ms), `#lee303Prob` pattern probability. (5) FX DESTRUCTION BUS `#lee303FxControls`; buttons `#lee303Stutter`, `#lee303Freeze` FILTER FREEZE, `#lee303Tape` TAPE DROP, `#lee303Panic` PANIC/MUTE. FX: overdrive, feedback, delay, reverb, chorus-style detune, bit reduction, resonant filter.

## 13. GLCTC1 0010110 synth (`#s101Panel`)
Head `#s101Status` "SYNTH ENGINE READY". Toolbar: `#s101CreateTrack`, `#s101TransportPlay`, `#s101Solo`, `#s101TransportStop`, `#s101TransportLength` 1/2/4/8, `#s101SendMaster`, `#s101Bypass`, `#s101AudioRec` REC AUDIO, `#s101MidiRec` SEND MIDI, `#s101StopRec`, `#s101SampleBtn` LOAD SAMPLE (hidden `#s101SampleFile`), `#s101Octave` 2-6, `#s101Hold` HOLD, `#s101ArpOn` ARP, `#s101ArpLatch` LATCH OFF, `#s101Tempo`.
Cards: 16-STEP SYNTH PATTERN (`#s101PatternLength` 8/16; `#s101PatternRoot` C2 D2 E2 G2 A2 C3 C4; `#s101PatternScale` Minor, Major, Phrygian, Pentatonic, Chromatic; `#s101PatternGate`; `#s101PatternRandom` GENERATE; `#s101PatternClear`; grid `#s101PatternGrid`, tap toggle, SHIFT-tap = accent). PLAYABLE KEYBOARD `#s101Keyboard` (touch/click/computer keys A-L; record audio or MIDI to DAW track). OSCILLATOR & CLASSIC MONO SYNTH `#s101MainControls` (JS). ARP/SEQUENCER `#s101ArpControls`, `#s101ArpRecord` SEND ARP TO MIDI TRACK, `#s101ArpClear` CLEAR HELD NOTES (modes up/down/updown/played/random; rates 1/4-1/32 + triplets). LAYER LAB `#s101Layers` (stack oscillators per octave/semitone/detune + sample layer). GLITCH/STUTTER `#s101Stutter`, `#s101Freeze`, `#s101Tape` TAPE STOP, `#s101Reverse` REVERSE SAMPLE, `#s101Random`, `#s101Reset` RESET FX; `#s101FxControls` (JS).

## 14. GALACTIC ONE (`#galacticOnePanel`, mount `#goApp`) - JS-rendered, only CSS visible
Jupiter-8 inspired polysynth with step sequencer (aria-label). CSS classes: `.g2-head` (planet orb `.g2-planet` reacts to level via --lvl, brand, sub, `canvas#goScope` 60px oscilloscope, `.g2-status`), `.g2-toolbar`, `.g2-patchbar` (patch bar), `.g2-rec` (record, pulses), `.g2-seg` segmented toggles, `.g2-ab` A/B patch slots (shows patch name `i`), `.g2-card`/`.g2-ct`, `.g2-tabs` (CSS comment says "permanently expanded sound-design sections (no tabs or menus)"), `.g2-knobs`, `.g2-macros`, `.g2-mx` (matrix), `.g2-grid` (step grid; --cols=8 <=720), `.g2-kbd`/`.g2-piano` (keyboard 104px on mobile), `.g2-wh`/`.g2-whknob`/`.g2-whtrack` (pitch/mod wheels), `.g2-side`, `.g2-sub-card`, `.g2-open-section` (2-col `.g2-cols` -> 1 col <=600). Mobile: scope full width; kbd stacks.

## 15. GALACTIC VOX (`#voxPanel`, mount `#voxApp`) - JS-rendered vocal engine
CSS classes: `.vx-orb`, `.vx-bigscope`, `.vx-load` (sample load), `.vx-pads` (4-col <=720), `.vx-pad`, `.vx-pad-tools`, `.vx-pad-unit`, `.vx-wave-label`. Reuses galacticone styling.

## 16. GLCTC1 MASTER CONSOLE / Workstation (`#wsPanel`, mount `#wsApp`, `#wsStatus` "WORKSTATION LOADING") - JS-rendered
Subtitle: "LIVE WAVE - SEQUENCER - ANALOG MIXER - KEYBOARD - ONE UNIT". CSS reveals sections: `.cn-wavepane`/`.cn-wave` live wave; `.cn-screen`/`.cn-glass`; `.cn-stabs`/`.cn-tab` tabs; sequencer `.cn-sq*` (sqbar, sqgrid, sqpages, sqrow, sqname, sqm) and `.ws-steps/.ws-step`, `.ws-scenes`; analog mixer `.cn-mixer`/`.cn-mixwrap`/`.cn-strips`/`.cn-ch` channel (fader `.cn-fader/.cn-fcap/.cn-ftrk`, LED meter `.cn-led`, `.cn-arm`, `.cn-kind`, `.cn-sel`, FX button `.cn-fxb`, drawer `.cn-drawer`), `.cn-master`, `.ws-strips/.ws-strip` (name + sliders), `.ws-meter`; live performance `.cn-live*` (livebar, livehead, livearms, live-module, live-pad(s), live-actions, live-arm, live-status); record pane `.cn-recordpane`; keyboard section `.cn-keysec` + KORG-style "K37" 37-key keyboard `.k37-*` (chassis, wheels `.k37-wheel`, knobs `.k37-knob`, ring, LCD `.k37-lcd`/`.k37-disp`, chips, buttons, power `.k37-pwr`, keybed `.k37-keys/.k37-key`); `.ws-pads` (PAD-64 per comment), `.ws-grid2`, `.ws-sound`, `.ws-des`, `.ws-card`, `.ws-readout`, `.ws-master`. Comments: "MASTER KEYBOARD KEYBED FIX: key states isolated from PAD-64 styling; only exact held MIDI note gets private highlight".

## 17. Keyboard shortcuts / hints seen in this slice
Ctrl+Z undo, Ctrl+Y redo, Ctrl+X/C/V object cut/copy/paste (paste at playhead); 0010110 keyboard computer keys A-L; Shift-tap step = accent (30LEE, 0010110); right-click step = slide (30LEE); Enter in `#wamUrl` loads plugin.

## 18. Responsive (@media) rules in this slice
- <=850: `.layout` single column (browser on top, browser tabs 5-col grid, body padding 0 10px 10px), `.lower` single col, library list 2-col, mix-grid 2-col, brand-right hidden, timeline-scroll max-height 480, mobile-note shown, tighter app/toolbar/metric padding.
- <=480: mix-grid 2-col, library list 1-col, track-label 170px, timeline --beatpx 18, status full width, transport buttons min 34px.
- >=768: `.padgrid` 8 cols, mixer track strip 172px, `.mfxbox` 210px, looper sliders grid auto-fill 160px, pad min-height 64. >=1100: strip 180px, pad 76px, lpbody single col.
- <=900: wsPanel k37 panel 1 col, keys 135px; `.ws-grid2` 1 col; `.ws-pads` 1 col. <=720: GALACTIC ONE grid 8 cols, kbd stacks, piano 104px; VOX pads 4-col. <=700: 80LA8 editor 1-col, voice list/fx 2-col, steps min 690px horizontally scrolls; 0010110 (<=600) 2-col controls; 30LEE grid 16x34px, keyboard 13x36 with scroll; 90MINE rows 82px+16x28 steps, pads 5-col, mix 2-col; Divine09 voice/sample grids 2-col, tool buttons 95px; wsPanel console channels 86px wide, fader 130px, LED 112px, master 140px; <=640 `.ws-strip` 2 col; <=560 k37 body 1-col, wheels centered, keys 120px; <=600 Action Sequencer lanes min 460px.

## 19. Parity gaps / ambiguities worth checking in JS slices
- Tab bar at <=850 declares 5 columns but 6 tabs exist.
- No visible bounce button in 909 panel (others have it); confirm in JS.
- Mixer strip, track row, plugin UI, modals, collapse bars, and the three JS-mounted big panels hold most per-control detail.
