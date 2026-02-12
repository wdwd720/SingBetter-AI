# PHASE 3 - Manual Test Plan

## Quick Start
1. `npm run dev`
2. Open the app and go to Live Coaching.

## Step-by-Step Checks
1. Upload mp3
   - Expect: upload succeeds and file name appears.
2. Quick transcribe (60s)
   - Expect: verses populate quickly; no errors.
3. Select verse
   - Expect: karaoke preview updates with selected lines.
4. Record once - ensure meter moves
   - Click Record once. Expect: meter moves in real time, countdown then recording starts.
5. Record silence
   - Stay silent for ~2 seconds.
   - Expect: toast warning "We did not hear voice" during recording.
6. Record flat singing
   - Sing obviously flat.
   - Expect: bias is negative; summary mentions flat; pitch accuracy lower.
7. Skip words intentionally
   - Miss a few words on purpose.
   - Expect: missed words list shows; word coach tips mention them.
8. Retry loop works (no double-click)
   - Click Retry same line once.
   - Expect: no double start, clean state transitions, no stuck states.
9. Do 5 attempts
   - Expect: history sparkline updates; app stays responsive.

## Debug Mode (Dev Only)
1. Toggle Debug to On (top right).
2. Expand Debug panel.
3. Check metrics:
   - voicedPct: 0.3-0.9 typical for real singing
   - biasCents: roughly -80 to +80 for normal singing
   - medianAbsErrorCents: 20-120 typical
   - timingMeanAbsMs: 80-300 typical
   - coveragePct: 0.6+ when you finish the verse
4. Click "Copy analysis JSON" and verify clipboard content.

## Pass Criteria
- Recording starts and stops with a single click.
- Input meter moves consistently when speaking or singing.
- Silence warning appears when no voice is detected.
- Summary and top issues feel consistent with the performance.
- Focus line is shown when line data exists.
- Drill steps are specific and bounded.
