export type OffsetEstimate = {
  offsetMs: number;
  method: "xcorr" | "onset" | "none";
  correlation?: number;
};

type OffsetOptions = {
  stepSec?: number;
  maxOffsetMs?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizedCorrelation = (a: number[], b: number[], lag: number) => {
  let sum = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let count = 0;

  for (let i = 0; i < a.length; i += 1) {
    const j = i + lag;
    if (j < 0 || j >= b.length) continue;
    const av = a[i];
    const bv = b[j];
    sum += av * bv;
    sumA += av;
    sumB += bv;
    sumAA += av * av;
    sumBB += bv * bv;
    count += 1;
  }

  if (count < 3) return 0;
  const denomA = sumAA - (sumA * sumA) / count;
  const denomB = sumBB - (sumB * sumB) / count;
  if (denomA <= 0 || denomB <= 0) return 0;
  const numerator = sum - (sumA * sumB) / count;
  return numerator / Math.sqrt(denomA * denomB);
};

const estimateOnset = (reference: number[], recording: number[]) => {
  const refMax = Math.max(...reference, 0);
  const recMax = Math.max(...recording, 0);
  const refThreshold = refMax * 0.4;
  const recThreshold = recMax * 0.4;
  const refIndex = reference.findIndex((v) => v >= refThreshold);
  const recIndex = recording.findIndex((v) => v >= recThreshold);
  if (refIndex < 0 || recIndex < 0) return null;
  return recIndex - refIndex;
};

export function estimateAlignmentOffsetMs(
  referenceEnvelope: number[],
  recordingEnvelope: number[],
  options: OffsetOptions = {}
): OffsetEstimate {
  const stepSec = options.stepSec ?? 0.05;
  const maxOffsetMs = options.maxOffsetMs ?? 800;
  if (!referenceEnvelope.length || !recordingEnvelope.length) {
    return { offsetMs: 0, method: "none" };
  }

  const maxLag = Math.max(1, Math.round(maxOffsetMs / (stepSec * 1000)));
  let bestLag = 0;
  let bestCorr = -Infinity;

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const corr = normalizedCorrelation(referenceEnvelope, recordingEnvelope, lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestCorr > 0.2) {
    return {
      offsetMs: clamp(Math.round(bestLag * stepSec * 1000), -maxOffsetMs, maxOffsetMs),
      method: "xcorr",
      correlation: bestCorr,
    };
  }

  const onsetLag = estimateOnset(referenceEnvelope, recordingEnvelope);
  if (typeof onsetLag === "number") {
    return {
      offsetMs: clamp(Math.round(onsetLag * stepSec * 1000), -maxOffsetMs, maxOffsetMs),
      method: "onset",
    };
  }

  return { offsetMs: 0, method: "none" };
}
