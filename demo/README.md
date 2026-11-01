# Demo materials

Everything here is **synthetic**: invented patients, phone numbers and reporters, recorded in the synthetic test organisation (`mednova-test-a`).

## The video

`PV-Assist-demo-live-system.mp4` (4 min 58 s, 1080p) walks through the live PV Assist site as NAFDAC's reviewers use it:

- line-list upload and codebook detection;
- validation, MedDRA suggestions, Fix, case decisions and Settings mappings;
- duplicates across two files;
- the batch quality flag and PMS referral, observed vs expected, and the signal screen;
- E2B(R3) (C.1.7, VigiFlow preflight, XML);
- PSUR screening and AI scientific review, and the AI data log.

Narration uses Microsoft's `en-US-SteffanNeural` voice through `edge-tts`. Recorded 1 November 2026.

## The demo line lists

Upload both with the source form **"Coded line list — reactions are local codes with a codebook"**:

- `linelists/DEMO-ondo-aefi-line-list-25-cases.xlsx`: the main demo. It has a codebook under the table, MedDRA terms to choose, reporter titles to map in Settings, errors for Fix to correct, a case to hold and a case to drop. It also contains a signal (Pentavalent × persistent crying) and a quality flag (batch MR-7712).
- `linelists/DEMO-ondo-aefi-lga-return-8-cases.xlsx`: an LGA return for the same month. Upload it after the 25-case file: 4 of its cases are duplicates found across the two files.

The same files are produced by `node scripts/seed/generate-demo-25.mjs` (into `scripts/seed/out/`).

## Remaking the video (`video-tools/`)

These are the scripts that made the video. They need:

- Node, plus Playwright installed in a folder named by `PW_DIR`;
- Python with `edge-tts`, `numpy` and `pillow`;
- ffmpeg.

`compose.py` uses `C:/Windows/Fonts` for the captions, so it runs on Windows. All of them run from `demo/video-tools/`.

1. **Reset the test organisation:** run `node scripts/seed/reset-test-org.mjs` from the repo root. It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. **Record:** with the e2e environment (`PW_DIR`, `TEST_PASSWORD`, `HEADLESS=1`, `SLOWMO=0`), run in order:
   1. `rec/rec-linelist.cjs`
   2. `rec/rec-evaluator.cjs`
   3. `rec/rec-e2b-psur.cjs`
   4. `rec/map-rest.cjs`, then `ONLY=e2b SKIP_EVALUATOR=1 REC_NAME=05-e2b-xml node rec/rec-e2b-psur.cjs`

   Frames go to `rec/out/`.

3. **Stills:** `node stills/sheet.mjs && node stills/shoot.cjs`.
4. **Voice:** `python tts.py` reads `narration.json`. Change a line there and run it again; `python tts.py <voice> <scene-id>` redoes a single scene.
5. **Assemble:**
   - `python compose.py prep`
   - `python compose.py build`, which uses `scenes.json` to say which part of which recording sits under each line of narration.

   To change only the captions, edit `build/captions.ass` and run `python compose.py burn`.

Never point the recording scripts at a real organisation's accounts.
