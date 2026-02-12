import type { PitchContour, PitchMetrics } from "./pitchMetrics";
import type { PitchComparison } from "./pitchCompare";

export type PitchCoach = {
  pitchAccuracyScore: number;
  pitchStabilityScore: number;
  biasCents: number;
  medianAbsErrorCents: number;
  voicedPct: number;
  compareAvailable: boolean;
  worstLines: Array<{
    lineIndex: number;
    text?: string;
    start: number;
    end: number;
    score: number;
    biasCents: number;
    tips: string[];
  }>;
  topIssues: string[];
  tips: string[];
  drill: { title: string; steps: string[]; targetLineIndex?: number };
  lowConfidence: boolean;
  message?: string;
};

export type PitchLine = {
  index: number;
  text?: string;
  start: number;
  end: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function buildPitchCoach(input: {
  userMetrics: PitchMetrics;
  referenceMetrics?: PitchMetrics | null;
  comparison?: PitchComparison | null;
  lineComparisons: Array<{
    line: PitchLine;
    comparison?: PitchComparison | null;
    userMetrics: PitchMetrics;
  }>;
}): PitchCoach {
  const { userMetrics, comparison } = input;
  const lowConfidence = userMetrics.lowConfidence;
  const hasComparison = Boolean(comparison);
  const pitchAccuracyScore = hasComparison
    ? comparison?.pitchAccuracyScore ?? 0
    : userMetrics.stabilityScore;
  const biasCents = comparison?.biasCents ?? 0;

  if (lowConfidence) {
    return {
      pitchAccuracyScore: 0,
      pitchStabilityScore: userMetrics.stabilityScore,
      biasCents: 0,
      medianAbsErrorCents: 0,
      voicedPct: userMetrics.voicedPct,
      compareAvailable: false,
      worstLines: [],
      topIssues: ["Low voice detection"],
      tips: ["Not enough clear voice detected - try louder/closer and reduce background music."],
      drill: {
        title: "Clear voice capture",
        steps: ["Move closer to the mic.", "Reduce background music volume.", "Record again with steady volume."],
      },
      lowConfidence: true,
      message: "Not enough clear voice detected - try louder/closer and reduce background music.",
    };
  }

  const pitchStabilityScore = userMetrics.stabilityScore;
  const topIssues: string[] = [];
  const tips: string[] = [];

  if (comparison) {
    if (biasCents < -40) {
      topIssues.push("Consistently flat");
      tips.push(`You're about ${Math.abs(biasCents)} cents flat on average.`);
    } else if (biasCents > 40) {
      topIssues.push("Consistently sharp");
      tips.push(`You're about ${Math.abs(biasCents)} cents sharp on average.`);
    }
  } else {
    tips.push("Reference pitch was unclear; focusing on stability only.");
  }

  if (pitchStabilityScore < 70) {
    topIssues.push("Pitch stability");
    tips.push(`Pitch wobbles on sustained notes (std ≈ ${Math.round(userMetrics.centsStdDev)} cents).`);
  }

  if (Math.abs(userMetrics.driftCentsPerSec) > 8) {
    topIssues.push("Pitch drift");
    tips.push(`Pitch drifts by ~${Math.round(userMetrics.driftCentsPerSec)} cents/sec.`);
  }

  if (userMetrics.jitterCentsRms > 70) {
    topIssues.push("Unsteady note transitions");
    tips.push("Note landings are shaky - aim to land on pitch sooner.");
  }

  const worstLines = input.lineComparisons
    .map((entry) => {
      const score =
        entry.comparison?.pitchAccuracyScore !== undefined
          ? entry.comparison.pitchAccuracyScore * 0.6 + entry.userMetrics.stabilityScore * 0.4
          : entry.userMetrics.stabilityScore;
      const lineBias = entry.comparison?.biasCents ?? 0;
      const lineTips: string[] = [];
      if (lineBias < -40) lineTips.push(`Line is ~${Math.abs(lineBias)} cents flat.`);
      if (lineBias > 40) lineTips.push(`Line is ~${Math.abs(lineBias)} cents sharp.`);
      if (entry.userMetrics.centsStdDev > 35) {
        lineTips.push("Pitch wobbles on longer notes.");
      }
      if (!lineTips.length) lineTips.push("Keep the pitch centered on this line.");
      return {
        lineIndex: entry.line.index,
        text: entry.line.text,
        start: entry.line.start,
        end: entry.line.end,
        score: Math.round(score),
        biasCents: lineBias,
        tips: lineTips,
      };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);

  if (!tips.length) {
    tips.push("Pitch accuracy looks good. Aim for even smoother stability.");
  }

  let drill: PitchCoach["drill"] = {
    title: "Pitch focus drill",
    steps: ["Sing the verse on a single vowel.", "Hold each long note for 3-5 seconds."],
  };

  if (biasCents < -40) {
    drill = {
      title: "Fix flat bias",
      steps: [
        "Sing slightly brighter with forward resonance.",
        "Match a reference hum for 2 seconds, then sing the line.",
      ],
    };
  } else if (biasCents > 40) {
    drill = {
      title: "Fix sharp bias",
      steps: ["Back off volume slightly.", "Aim just under the pitch, then settle in."],
    };
  } else if (pitchStabilityScore < 70) {
    drill = {
      title: "Stability drill",
      steps: [
        "Sustain on 'ng' for 5 seconds keeping pitch steady.",
        "Then sing line 1 on a single vowel.",
      ],
      targetLineIndex: worstLines[0]?.lineIndex,
    };
  } else if (userMetrics.jitterCentsRms > 70) {
    drill = {
      title: "Landing drill",
      steps: [
        "Sing the first word of each line staccato.",
        "Then connect smoothly without sliding.",
      ],
      targetLineIndex: worstLines[0]?.lineIndex,
    };
  }

  return {
    pitchAccuracyScore,
    pitchStabilityScore,
    biasCents,
    medianAbsErrorCents: comparison?.medianAbsErrorCents ?? 0,
    voicedPct: userMetrics.voicedPct,
    compareAvailable: hasComparison,
    worstLines,
    topIssues: topIssues.slice(0, 3),
    tips: tips.slice(0, 6),
    drill,
    lowConfidence: false,
  };
}
