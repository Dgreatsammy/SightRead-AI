# SightRead AI: brief for Replit Agent

Read this file first. Do NOT explore the repo broadly: it is large (the folder
`tools/audiveris/runtime` is vendored and must never be opened or edited).

## What the app is
Choir practice app. Upload a PDF or photo of sheet music -> the server reads it with Audiveris
(`artifacts/api-server/src/routes/omr.ts`) -> MusicXML -> drawn with OpenSheetMusicDisplay and
played with Web Audio (`artifacts/sightread-ai/src/lib/playback.ts`). People pick a part
(Soprano, Alto, Tenor, Bass) and listen to it. The page is `artifacts/sightread-ai/src/pages/reader.tsx`.

## Rules that must not be broken
- The DRAWN sheet shows what the recogniser read; fixes for sound (voice splitting, repeats) live in
  playback code only. Drawn-sheet clean-ups live in `lib/lyricCleanup.ts`, `lib/clefCleanup.ts`, `lib/restFill.ts`.
- Never change a note's pitch silently. Never delete real notes.
- Every behaviour change needs a test. Real recognised files are in `src/lib/__fixtures__/`.
- Work on a branch. Never push to main. Show the diff before committing.
- No new dependencies unless asked.

## How to check your work (run only these)
- Tests: `pnpm --filter @workspace/sightread-ai test`   (must stay green; about 166 tests)
- Types: `pnpm --filter @workspace/sightread-ai exec tsc -p tsconfig.json --noEmit`
- Do not run the full build or start the dev server unless the task says so.

## Where we are
Measured on five real pieces (`tools/omr-benchmark/README.md`): clean PDFs read about 96% of notes
right; small images (about 800 px wide) about 76%; words are the weakest part. Done and tested:
S/A/T/B playback split, pickup and short-bar timing, rests drawn, footer text removed from lyrics,
repeat playback, ghost octave clefs removed, size warning, original-image view, timing diagnostics
(`?debug=playback`), PWA files.

## Open tasks, in priority order (do ONE per request, stop after each)
1. Phone layout in `reader.tsx` (Android Chrome, 360 px wide): title is clipped, the score area is
   narrower than the screen, lyrics overlap. Done when: no horizontal scrolling at 360 px and text is readable.
2. In-app Install button (`beforeinstallprompt`), iPhone "Add to Home Screen" instructions, and an
   "Open in Chrome/Safari" hint when the page is inside WhatsApp's browser.
3. Correction screen: choose a bar, change a note up/down, delete it, edit a lyric word. Keep it a plain
   list (no tapping on the drawn sheet). Edits must update both the sheet and the sound.
4. Starter library of public-domain pieces in clean MusicXML (user supplies files from CPDL).
5. Upload progress and retry; remember the last few scores on the device for offline practice.
6. Spelling help for recognised words (dictionary pass first).
7. Toggle to hide dynamics and trill marks; show a real part name instead of "Voice".

## Known recognition limits (do not try to "fix" these in playback)
The recogniser sometimes invents or drops a rest, misses a repeat sign, or reads a note an octave off.
Only a correction screen can fix those.

## Keeping credit use low
- Use the cheapest mode that works for the task; avoid the most expensive modes.
- One small task per request, with the exact file names and what "done" means.
- Do not ask for a rewrite, a refactor or "fix all errors".
- Stop and ask if a task needs more than the files named in it.
