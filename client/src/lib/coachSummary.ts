import type { PitchCoach } from "@/lib/coachPitch";
import type { TimingMetrics } from "@/lib/coachCore";
import type { WordCoach } from "@/lib/coachWords";

type CoachSummaryInput = {
  pitchCoach?: PitchCoach | null;
  wordCoach?: WordCoach | null;
  timingMetrics?: TimingMetrics | null;
};

export function buildCoachSummary({
  pitchCoach,
  wordCoach,
  timingMetrics,
}: CoachSummaryInput): string {
  if (!pitchCoach && !wordCoach && !timingMetrics) {
    return "";
  }

  const sentences: string[] = [];

  const wordAccuracy = wordCoach?.wordAccuracyScore ?? 0;
  const hasWordIssue = wordCoach ? wordAccuracy < 70 : false;
  const hasTimingIssue = timingMetrics
    ? timingMetrics.meanAbsDeltaMs > 180 || timingMetrics.within120Pct < 0.55
    : false;
  const hasPitchIssue =
    pitchCoach &&
    !pitchCoach.lowConfidence &&
    (pitchCoach.pitchAccuracyScore < 70 || pitchCoach.pitchStabilityScore < 70);

  if (pitchCoach?.lowConfidence) {
    sentences.push(
      "We could not detect enough clear voice to score pitch reliably."
    );
  }

  if (hasWordIssue) {
    if (wordCoach?.missedWords.length) {
      sentences.push(
        `You missed a few words, including ${wordCoach.missedWords
          .slice(0, 3)
          .map((word) => `'${word}'`)
          .join(", ")}.`
      );
    } else {
      sentences.push("Lyrics accuracy is the main thing to clean up.");
    }
  } else if (hasTimingIssue && timingMetrics) {
    const direction =
      timingMetrics.medianDeltaMs > 60
        ? "late"
        : timingMetrics.medianDeltaMs < -60
          ? "early"
          : "inconsistent";
    sentences.push(
      `Timing is close overall, but you're slightly ${direction} by about ${Math.abs(
        timingMetrics.medianDeltaMs
      )}ms.`
    );
  } else if (hasPitchIssue && pitchCoach) {
    if (pitchCoach.compareAvailable && Math.abs(pitchCoach.biasCents) > 35) {
      sentences.push(
        `You're singing a bit ${pitchCoach.biasCents > 0 ? "sharp" : "flat"} on average.`
      );
    } else if (pitchCoach.pitchStabilityScore < 70) {
      sentences.push("Pitch wobbles on longer notes. Aim for a steadier hold.");
    } else {
      sentences.push("Pitch accuracy is close; aim to land the first note sooner.");
    }
  }

  if (wordCoach?.rushedPhrases.length) {
    sentences.push(
      `You rushed the phrase "${wordCoach.rushedPhrases[0]}".`
    );
  } else if (wordCoach?.latePhrases.length) {
    sentences.push(
      `You came in late on "${wordCoach.latePhrases[0]}".`
    );
  }

  if (!sentences.length) {
    sentences.push("Nice take. Keep the same verse and tighten the timing.");
  }

  if (sentences.length < 2) {
    sentences.push("Stay relaxed and focus on clear word starts.");
  }

  return sentences.slice(0, 4).join(" ");
}
