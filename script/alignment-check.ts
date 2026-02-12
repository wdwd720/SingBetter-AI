import { alignWords, type WordToken } from "../server/lib/alignment";

const reference: WordToken[] = [
  { word: "Hello", start: 0.0, end: 0.4, index: 0 },
  { word: "from", start: 0.4, end: 0.7, index: 1 },
  { word: "the", start: 0.7, end: 0.9, index: 2 },
  { word: "other", start: 0.9, end: 1.2, index: 3 },
  { word: "side", start: 1.2, end: 1.5, index: 4 },
];

const user: WordToken[] = [
  { word: "hello", start: 0.05, end: 0.45, index: 0 },
  { word: "from", start: 0.46, end: 0.75, index: 1 },
  { word: "the", start: 0.78, end: 1.0, index: 2 },
  { word: "far", start: 1.02, end: 1.25, index: 3 },
  { word: "side", start: 1.3, end: 1.6, index: 4 },
];

const result = alignWords(reference, user, {
  referenceOffsetSec: 0,
  userOffsetSec: 0,
  referenceDurationSec: 1.5,
  userDurationSec: 1.6,
});

console.log(JSON.stringify(result, null, 2));
