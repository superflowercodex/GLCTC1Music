# GLCTC1 Studio redesign: plan

Branch `redesign`. Original files are backed up (tag `backup-original-2026-10-22`, copy at `../GLCTC1Music-ORIGINAL-2026-10-22`). `daw.html` is not edited until the new app reaches parity; it stays as the classic fallback.

## Shape
- Source in `daw-src/` (React, Vite, TypeScript). `npm run build` writes plain static files to `daw/`, served by GitHub Pages at `/daw/`. No server needed.
- Hash routing (`#/arrange`, `#/play/galactic-one`) because Pages cannot rewrite unknown paths.
- Audio engines are copied out of `daw.html` into DOM-free modules. The classic page stays the reference until each engine matches it.
- Project format is versioned. Old `.glctc1` packages and old IndexedDB projects must open.

## Storage safety (old and new share one domain)
`/daw.html` and `/daw/` share the same browser storage because they share a domain. Rules:
- The new app writes only to its own names: IndexedDB `glctc1-studio-v1`, localStorage keys prefixed `glctc1studio.`.
- It never writes to, renames or deletes anything the old DAW uses. Old data is read-only: it is copied into the new store on import, with the original left in place.
- Gate before any push: save a project in the old DAW, open it in the new one, change it, go back to the old one, and confirm both still open. Repeat in the other direction.

## One screen
The shell is `100dvh`. Every room is a grid with `min-height:0` children, so only long lists scroll inside their own panel. Smallest supported window: 1280x720. Also checked at 1440x900, iPad landscape and 390x844. Sections collapse into tabs before text shrinks below 15px.

## Motion
UI springs and room transitions. Meters and playheads read the audio analyser and draw directly, not through React state. One shared Three.js aurora shader behind every room, reactive to the master level. A real 3D scene in the Stage room. Frame budget, pause when hidden, lighter on phones, reduce-motion setting.

## Phases
0. Backup, scaffold, reference renders, project format notes.
1. Shell, Arrange, transport, mixer: first usable DAW (import, record, edit, export).
2. Instruments one at a time: 80LA8, Galactic One, then the rest.
3. Song, Stage (3D), Library, Sheets, old-project migration.
4. Phone layout, offline app, performance pass.

Each phase is checked on screen and, for audio, against reference renders taken from the classic page.

## Known bugs to fix, not copy
Dead Create Track on Divine09, 30LEE and 0010110. Song bounce and export call the timeline export. `fmtBpmGLCTC_CLOCK` typo at `daw.html:1044`. Vox and PAD-64 samples are not saved. Master effect values are not saved. Action-sequencer import can click any element by id. Scheduler timer slows in background tabs.
