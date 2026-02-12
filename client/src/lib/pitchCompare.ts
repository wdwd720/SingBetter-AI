import type { PitchContour } from "./pitchMetrics";

export type PitchComparison = {
  medianAbsErrorCents: number;
  pctWithin50Cents: number;
  pctWithin100Cents: number;
  biasCents: number;
  pitchAccuracyScore: number;
  overlapPct: number;
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function comparePitchContours(
  reference: PitchContour,
  user: PitchContour
): PitchComparison | null {
  const refFrames = reference.frames;
  const userFrames = user.frames;
  if (!refFrames.length || !userFrames.length) return null;

  const hopRef = reference.hopSec;
  const errors: number[] = [];
  const signed: number[] = [];
  let overlap = 0;
  let voicedUser = 0;

  userFrames.forEach((frame) => {
    if (!frame.voiced || !frame.f0Hz) return;
    voicedUser += 1;
    const idx = Math.round(frame.t / hopRef);
    const ref = refFrames[idx];
    if (!ref || !ref.voiced || !ref.f0Hz) return;
    overlap += 1;
    const error = 1200 * Math.log2(frame.f0Hz / ref.f0Hz);
    errors.push(Math.abs(error));
    signed.push(error);
  });

  if (!errors.length) return null;

  const medianAbsErrorCents = Math.round(median(errors));
  const biasCents = Math.round(median(signed));
  const pctWithin50Cents = errors.filter((e) => e <= 50).length / errors.length;
  const pctWithin100Cents = errors.filter((e) => e <= 100).length / errors.length;
  const overlapPct = voicedUser ? overlap / voicedUser : 0;

  const pitchAccuracyScore = clamp(
    Math.round(100 - medianAbsErrorCents * 1.2 - (1 - pctWithin50Cents) * 30),
    0,
    100
  );

  return {
    medianAbsErrorCents,
    pctWithin50Cents,
    pctWithin100Cents,
    biasCents,
    pitchAccuracyScore,
    overlapPct,
  };
}
