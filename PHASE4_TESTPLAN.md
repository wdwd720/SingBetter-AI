# PHASE 4 - Manual Test Plan

## Setup
1. `npm run dev`
2. Open Live Coaching.

## Tests
1. Speak only (no singing)
   - Expect: diction low confidence message, pitch low confidence message, recording tips only.
2. Hum a steady note
   - Expect: note coach stable, diction low priority, breath coach neutral.
3. Correct lyrics but mumbled
   - Expect: word accuracy OK, diction clarity low, tips mention articulation.
4. Sing sharp or flat
   - Expect: Notes & Intonation flags cents-off note, summary mentions sharp/flat.
5. Phrase tail drops
   - Expect: Breath & Phrasing tips mention line tail dropping.
6. 5 attempts in a row
   - Expect: no lag, reference caches reused, history updates.

## Debug Mode (Dev Only)
1. Toggle Debug in the header.
2. Confirm new metrics:
   - dictionClarityScore
   - noteAccuracyScore
   - phrasingScore
   - medianAbsErrorCents
3. Copy analysis JSON and verify it includes diction/note/breath objects.

## Typical Ranges
- dictionClarityScore: 55-90
- noteAccuracyScore: 40-90
- phrasingScore: 60-95
