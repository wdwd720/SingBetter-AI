import type { WordFeedback } from "@/components/live-coaching/types";
import type { PitchMetrics } from "@/lib/pitchMetrics";

export type TimingMetrics = {
  meanAbsDeltaMs: number;
  medianDeltaMs: number;
  within120Pct: number;
  timingSlope: number;
};

export type CoachCoreResult = {
  subscores: {
    word: number;
    timing: number;
    pitch: number;
    stability: number;
  };
  topIssues: string[];
  tips: string[];
  drill: {
    type: "repeat_segment" | "slow_down" | "timing_lock" | "accuracy_clean" | "pitch_stability";
    note: string;
  };
  timingMetrics: TimingMetrics;
  wordAccuracyPct: number;
  missedWords: string[];
  paceRatio?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
};

const linearSlope = (xs: number[], ys: number[]) => {
  if (xs.length === 0 || xs.length !== ys.length) return 0;
  const meanX = xs.reduce((acc, val) => acc + val, 0) / xs.length;
  const meanY = ys.reduce((acc, val) => acc + val, 0) / ys.length;
  let num = 0;
  let denom = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    denom += dx * dx;
  }
  return denom === 0 ? 0 : num / denom;
};

export function computeTimingMetrics(perWord: WordFeedback[]): TimingMetrics {
  const matched = perWord.filter((word) =>
    word.status === "correct" ||
    word.status === "correct_early" ||
    word.status === "correct_late"
  );
  const deltas = matched
    .map((word) => word.deltaMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const meanAbsDeltaMs = deltas.length
    ? Math.round(deltas.reduce((acc, val) => acc + Math.abs(val), 0) / deltas.length)
    : 0;
  const medianDeltaMs = deltas.length ? Math.round(median(deltas)) : 0;
  const within120 = deltas.filter((val) => Math.abs(val) <= 120).length;
  const within120Pct = deltas.length ? within120 / deltas.length : 0;

  const xs = matched.map((word) => word.refStart);
  const timingSlope = deltas.length ? linearSlope(xs, deltas) : 0;

  return { meanAbsDeltaMs, medianDeltaMs, within120Pct, timingSlope };
}

export function buildCoachFeedback(input: {
  perWord: WordFeedback[];
  pitchMetrics?: PitchMetrics;
  serverPitchScore?: number;
  serverStabilityScore?: number;
  paceRatio?: number;
}): CoachCoreResult {
  const perWord = input.perWord ?? [];
  const total = perWord.length;
  const correct = perWord.filter((word) =>
    word.status === "correct" ||
    word.status === "correct_early" ||
    word.status === "correct_late"
  ).length;
  const wordAccuracyPct = total ? Math.round((correct / total) * 100) : 0;
  const missedWords = perWord
    .filter((word) => word.status === "missed" || word.status === "incorrect")
    .map((word) => word.refWord)
    .filter(Boolean);

  const timingMetrics = computeTimingMetrics(perWord);
  const timingPenalty = clamp(timingMetrics.meanAbsDeltaMs / 4, 0, 60);
  const withinPenalty = clamp((0.7 - timingMetrics.within120Pct) * 100, 0, 30);
  const slopePenalty = clamp(Math.abs(timingMetrics.timingSlope) / 6, 0, 20);
  const timingScore = clamp(Math.round(100 - timingPenalty - withinPenalty - slopePenalty), 0, 100);

  const stabilityScore =
    typeof input.pitchMetrics?.stabilityScore === "number"
      ? input.pitchMetrics.stabilityScore
      : typeof input.serverStabilityScore === "number"
        ? Math.round(input.serverStabilityScore)
        : 50;

  let pitchScore =
    typeof input.serverPitchScore === "number"
      ? Math.round(input.serverPitchScore)
      : Math.round(50 + (input.pitchMetrics?.voicedPct ?? 0) * 50);

  if (input.pitchMetrics?.lowConfidence) {
    pitchScore = Math.min(pitchScore, 40);
  }

  const subscores = {
    word: clamp(wordAccuracyPct, 0, 100),
    timing: timingScore,
    pitch: clamp(pitchScore, 0, 100),
    stability: clamp(stabilityScore, 0, 100),
  };

  const topIssues: string[] = [];
  const tips: string[] = [];
  const issuesAvailable = () => topIssues.length < 3;

  if (wordAccuracyPct < 70 && issuesAvailable()) {
    topIssues.push("Lyrics accuracy");
    const missed = missedWords.slice(0, 6).join(", ");
    tips.push(
      missed ? `You missed ${missedWords.length} words: ${missed}.` : "Focus on hitting every word clearly."
    );
  }

  if (
    (timingMetrics.meanAbsDeltaMs > 180 || timingMetrics.within120Pct < 0.55) &&
    issuesAvailable()
  ) {
    topIssues.push("Timing tightness");
    const lateEarly =
      timingMetrics.medianDeltaMs > 60
        ? "late"
        : timingMetrics.medianDeltaMs < -60
          ? "early"
          : "inconsistent";
    tips.push(
      `You're ${lateEarly} on average by ~${Math.abs(timingMetrics.medianDeltaMs)}ms.`
    );
    tips.push(
      `Only ${Math.round(timingMetrics.within120Pct * 100)}% of words land within 120ms.`
    );
  }

  if (
    input.pitchMetrics?.voicedPct &&
    input.pitchMetrics.voicedPct > 0.4 &&
    stabilityScore < 70 &&
    issuesAvailable()
  ) {
    topIssues.push("Pitch stability");
    tips.push(
      `Pitch stability is shaky (+/-${Math.round(input.pitchMetrics.centsStdDev)} cents).`
    );
  }

  if (issuesAvailable() && input.paceRatio) {
    if (input.paceRatio > 1.12) {
      topIssues.push("Rushing the verse");
      tips.push("You're slightly fast. Slow down and land consonants on the beat.");
    } else if (input.paceRatio < 0.88) {
      topIssues.push("Dragging the verse");
      tips.push("You're a bit slow. Push the phrases forward to match the reference.");
    }
  }

  if (tips.length === 0) {
    tips.push("Great take. Keep the timing tight and words clean.");
  }

  let drill: CoachCoreResult["drill"] = {
    type: "accuracy_clean",
    note: "Speak the verse in rhythm (no melody) twice, then record again.",
  };

  if (wordAccuracyPct < 70) {
    drill = {
      type: "accuracy_clean",
      note: "Speak the verse in rhythm (no melody) twice, then record again.",
    };
  } else if (timingMetrics.meanAbsDeltaMs > 180 || timingMetrics.within120Pct < 0.55) {
    drill = {
      type: "timing_lock",
      note: "Clap/tap the beat, then record focusing on consonants slightly earlier.",
    };
  } else if (input.pitchMetrics?.voicedPct && stabilityScore < 70) {
    drill = {
      type: "pitch_stability",
      note: "Hum the verse melody on 'ng' once, then record again.",
    };
  }

  return {
    subscores,
    topIssues,
    tips: tips.slice(0, 8),
    drill,
    timingMetrics,
    wordAccuracyPct,
    missedWords: missedWords.slice(0, 10),
    paceRatio: input.paceRatio,
  };
}
