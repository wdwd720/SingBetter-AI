export type PitchSample = {
  time: number;
  frequency: number;
};

export type PerformanceAnalysisInput = {
  referenceDurationSec?: number;
  recordingDurationSec?: number;
  referenceContour?: PitchSample[];
  recordingContour?: PitchSample[];
  referenceEnvelope?: number[];
  recordingEnvelope?: number[];
  estimatedOffsetMs?: number;
  practiceMode?: PracticeMode;
  wordScore?: number;
};

export type PerformanceAnalysisResult = {
  overall: number;
  pitch: number;
  timing: number;
  stability: number;
  words?: number;
  label: string;
  tips: string[];
  alignment: {
    timingCorrelation: number;
  };
};

export type PracticeMode = "full" | "words" | "timing" | "pitch";

export type PerformanceWeights = {
  pitch: number;
  timing: number;
  stability: number;
  words: number;
};

const MIN_PITCH_HZ = 50;
const MAX_PITCH_HZ = 1100;

const DEFAULT_WEIGHTS: PerformanceWeights = {
  pitch: 0.4,
  timing: 0.25,
  stability: 0.2,
  words: 0.15,
};

const PRACTICE_WEIGHTS: Record<PracticeMode, PerformanceWeights> = {
  full: DEFAULT_WEIGHTS,
  words: { pitch: 0.1, timing: 0.15, stability: 0.05, words: 0.7 },
  timing: { pitch: 0.1, timing: 0.7, stability: 0.05, words: 0.15 },
  pitch: { pitch: 0.7, timing: 0.1, stability: 0.2, words: 0.0 },
};

const normalizeWeights = (weights: PerformanceWeights) => {
  const total =
    weights.pitch + weights.timing + weights.stability + weights.words || 1;
  return {
    pitch: weights.pitch / total,
    timing: weights.timing / total,
    stability: weights.stability / total,
    words: weights.words / total,
  };
};

export const resolveWeights = (mode?: PracticeMode): PerformanceWeights =>
  mode && PRACTICE_WEIGHTS[mode] ? PRACTICE_WEIGHTS[mode] : DEFAULT_WEIGHTS;

export const computeOverallScore = (
  scores: { pitch: number; timing: number; stability: number; words?: number },
  weights: PerformanceWeights
) => {
  const normalized = normalizeWeights(weights);
  const wordScore = typeof scores.words === "number" ? scores.words : 0;
  const overall =
    scores.pitch * normalized.pitch +
    scores.timing * normalized.timing +
    scores.stability * normalized.stability +
    wordScore * normalized.words;
  return Math.round(overall);
};

function centsOff(reference: number, actual: number): number {
  if (reference <= 0 || actual <= 0) return 0;
  return 1200 * Math.log2(actual / reference);
}

function sanitizeContour(samples: PitchSample[]): PitchSample[] {
  return samples.map((sample) => {
    if (sample.frequency < MIN_PITCH_HZ || sample.frequency > MAX_PITCH_HZ) {
      return { ...sample, frequency: 0 };
    }
    return sample;
  });
}

function averageAbsoluteCentsDiff(reference: PitchSample[], actual: PitchSample[]): number {
  if (!reference.length || !actual.length) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < Math.min(reference.length, actual.length); i++) {
    if (reference[i].frequency <= 0 || actual[i].frequency <= 0) continue;
    total += Math.abs(centsOff(reference[i].frequency, actual[i].frequency));
    count++;
  }
  return count ? total / count : 0;
}

function pitchStabilityScore(samples: PitchSample[]): number {
  const voiced = samples.filter((s) => s.frequency > 0);
  if (voiced.length < 5) return 50;
  const mean = voiced.reduce((acc, s) => acc + s.frequency, 0) / voiced.length;
  const variance =
    voiced.reduce((acc, s) => acc + Math.pow(s.frequency - mean, 2), 0) / voiced.length;
  const std = Math.sqrt(variance);
  const centsStd = mean > 0 ? 1200 * Math.log2((mean + std) / mean) : 0;
  return Math.max(0, Math.min(100, Math.round(100 - centsStd * 4)));
}

function energyCorrelation(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const len = Math.min(a.length, b.length);
  const meanA = a.slice(0, len).reduce((acc, val) => acc + val, 0) / len;
  const meanB = b.slice(0, len).reduce((acc, val) => acc + val, 0) / len;
  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < len; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  if (!denomA || !denomB) return 0;
  return Math.max(0, Math.min(1, num / Math.sqrt(denomA * denomB)));
}

function averageEnergy(envelope: number[]): number {
  if (!envelope.length) return 0;
  return envelope.reduce((acc, val) => acc + val, 0) / envelope.length;
}

function shiftEnvelope(envelope: number[], offsetBins: number): number[] {
  if (offsetBins === 0) return envelope;
  const result = new Array(envelope.length).fill(0);
  for (let i = 0; i < envelope.length; i++) {
    const j = i + offsetBins;
    if (j < 0 || j >= envelope.length) continue;
    result[j] = envelope[i];
  }
  return result;
}

function buildTips({
  pitchScore,
  timingScore,
  stabilityScore,
  label,
  tooShort,
  lowSignal,
}: {
  pitchScore: number;
  timingScore: number;
  stabilityScore: number;
  label: string;
  tooShort: boolean;
  lowSignal: boolean;
}) {
  const tips: string[] = [];
  if (lowSignal) {
    tips.push("Low input level detected. Try moving closer to the mic or increasing input gain.");
    return tips;
  }
  if (tooShort) {
    tips.push("Recording is very short. Try a longer take for better scoring.");
  }
  if (label === "Pitch Accuracy" && pitchScore < 75) {
    tips.push("Pitch accuracy needs tightening. Match the reference tone early in each line.");
  }
  if (label === "Tone Match" && pitchScore < 75) {
    tips.push("Tone match is off. Focus on resonance and dynamics to match the reference.");
  }
  if (timingScore < 75) {
    tips.push("Timing is loose. Enter phrases right on the reference cue.");
  }
  if (stabilityScore < 75) {
    tips.push("Stability could improve. Hold sustained notes steady.");
  }
  if (!tips.length) {
    tips.push("Great take. Try a fresh pass for even tighter timing.");
  }
  return tips;
}

export function analyzePerformance(input: PerformanceAnalysisInput): PerformanceAnalysisResult {
  const referenceContour = sanitizeContour(input.referenceContour || []);
  const recordingContour = sanitizeContour(input.recordingContour || []);
  const referenceEnvelope = input.referenceEnvelope || [];
  const rawRecordingEnvelope = input.recordingEnvelope || [];
  const stepSec =
    referenceEnvelope.length && input.referenceDurationSec
      ? input.referenceDurationSec / referenceEnvelope.length
      : rawRecordingEnvelope.length && input.recordingDurationSec
        ? input.recordingDurationSec / rawRecordingEnvelope.length
        : 0.05;
  const offsetBins =
    typeof input.estimatedOffsetMs === "number" && stepSec > 0
      ? Math.round(input.estimatedOffsetMs / (stepSec * 1000))
      : 0;
  const recordingEnvelope =
    offsetBins !== 0 ? shiftEnvelope(rawRecordingEnvelope, -offsetBins) : rawRecordingEnvelope;
  const avgEnergy = averageEnergy(recordingEnvelope);
  const lowSignal = avgEnergy > 0 && avgEnergy < 0.002;
  const tooShort =
    input.recordingDurationSec !== undefined && input.recordingDurationSec < 3;

  const voicedRatio =
    referenceContour.filter((sample) => sample.frequency > 0).length /
    Math.max(1, referenceContour.length);

  let label = "Pitch Accuracy";
  let pitchScore = 55;
  if (referenceContour.length && recordingContour.length && !lowSignal) {
    if (voicedRatio < 0.3) {
      label = "Tone Match";
      pitchScore = Math.round(energyCorrelation(referenceEnvelope, recordingEnvelope) * 100);
    } else {
      const avgCents = averageAbsoluteCentsDiff(referenceContour, recordingContour);
      pitchScore = Math.max(0, Math.round(100 - Math.min(100, avgCents * 2)));
    }
  }

  let timingScore = 60;
  const timingCorrelation = energyCorrelation(referenceEnvelope, recordingEnvelope);
  const durationScore =
    input.referenceDurationSec && input.recordingDurationSec
      ? Math.max(
          0,
          Math.round(
            100 -
              Math.min(
                100,
                (Math.abs(input.recordingDurationSec - input.referenceDurationSec) /
                  Math.max(0.1, input.referenceDurationSec)) *
                  120
              )
          )
        )
      : 60;
  if (!lowSignal) {
    if (timingCorrelation > 0) {
      timingScore = Math.round(Math.min(100, timingCorrelation * 85 + durationScore * 0.15));
    } else {
      timingScore = durationScore;
    }
  }

  const stabilityScore = recordingContour.length && !lowSignal
    ? pitchStabilityScore(recordingContour)
    : Math.max(40, Math.min(90, Math.round(55 + timingCorrelation * 20)));

  if (lowSignal) {
    pitchScore = 0;
    timingScore = 0;
  }

  const weights = resolveWeights(input.practiceMode);
  const overall = computeOverallScore(
    {
      pitch: pitchScore,
      timing: timingScore,
      stability: stabilityScore,
      words: input.wordScore,
    },
    weights
  );

  return {
    overall,
    pitch: pitchScore,
    timing: timingScore,
    stability: stabilityScore,
    ...(typeof input.wordScore === "number" ? { words: input.wordScore } : {}),
    label,
    tips: buildTips({ pitchScore, timingScore, stabilityScore, label, tooShort, lowSignal }),
    alignment: { timingCorrelation },
  };
}
