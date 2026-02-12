import type { PitchCoach } from "@/lib/coachPitch";
import type { WordCoach } from "@/lib/coachWords";

export type DrillPlan = {
  focus: "pitch" | "timing" | "lyrics";
  steps: string[];
  repeatCount: number;
  targetLineIndex?: number;
};

type DrillInput = {
  pitchCoach?: PitchCoach | null;
  wordCoach?: WordCoach | null;
  practiceMode?: "full" | "words" | "timing" | "pitch";
};

export function buildDrillPlan({ pitchCoach, wordCoach, practiceMode = "full" }: DrillInput): DrillPlan {
  const wordAccuracy = wordCoach?.wordAccuracyScore ?? 100;
  const hasMissed = (wordCoach?.missedWords?.length ?? 0) > 0;
  const hasRushed = (wordCoach?.rushedPhrases?.length ?? 0) > 0;
  const hasLate = (wordCoach?.latePhrases?.length ?? 0) > 0;

  if (practiceMode === "words") {
    return {
      focus: "lyrics",
      repeatCount: 3,
      steps: [
        "Listen once to the reference line.",
        "Speak the line in rhythm twice (no melody).",
        "Sing the line on one vowel for 2 reps, then add the real words.",
        "Record again aiming for every word start.",
      ],
    };
  }

  if (practiceMode === "timing") {
    return {
      focus: "timing",
      repeatCount: 3,
      steps: [
        "Set a slow metronome and clap the beat for 30 seconds.",
        "Speak the line on the beat twice, then sing it once with the same timing.",
        "Record again, landing consonants right on the click.",
      ],
    };
  }

  if (practiceMode === "pitch" && pitchCoach && !pitchCoach.lowConfidence) {
    return {
      focus: "pitch",
      targetLineIndex: pitchCoach.worstLines[0]?.lineIndex,
      repeatCount: 3,
      steps: [
        "Hum the reference pitch for 2 seconds, then match it for 2 seconds.",
        "Sing the target line gently 3 times, aiming slightly above the pitch.",
        "Record again and keep the note steady.",
      ],
    };
  }

  if (hasMissed || wordAccuracy < 70) {
    return {
      focus: "lyrics",
      repeatCount: 3,
      steps: [
        "Listen once to the reference line.",
        "Speak the line in rhythm twice (no melody).",
        "Sing the line on one vowel for 2 reps, then add the real words.",
        "Record again aiming for every word start.",
      ],
    };
  }

  if (hasRushed || hasLate) {
    return {
      focus: "timing",
      repeatCount: 3,
      steps: [
        "Set a slow metronome and clap the beat for 30 seconds.",
        "Speak the line on the beat twice, then sing it once with the same timing.",
        "Record again, landing consonants right on the click.",
      ],
    };
  }

  if (pitchCoach && !pitchCoach.lowConfidence) {
    if (pitchCoach.compareAvailable && pitchCoach.biasCents < -35) {
      return {
        focus: "pitch",
        targetLineIndex: pitchCoach.worstLines[0]?.lineIndex,
        repeatCount: 3,
        steps: [
          "Hum the reference pitch for 2 seconds, then match it for 2 seconds.",
          "Sing the target line gently 3 times, aiming slightly above the pitch.",
          "Record again and keep the note steady.",
        ],
      };
    }

    if (pitchCoach.compareAvailable && pitchCoach.biasCents > 35) {
      return {
        focus: "pitch",
        targetLineIndex: pitchCoach.worstLines[0]?.lineIndex,
        repeatCount: 3,
        steps: [
          "Back off volume and relax the jaw.",
          "Aim slightly under the target note for 2 seconds, then settle on it.",
          "Sing the target line 3 times with a smooth landing, then record.",
        ],
      };
    }

    if (pitchCoach.pitchStabilityScore < 70) {
      return {
        focus: "pitch",
        targetLineIndex: pitchCoach.worstLines[0]?.lineIndex,
        repeatCount: 3,
        steps: [
          "Sustain a single vowel for 5 seconds, repeat 3 times.",
          "Sing the target line on one vowel twice, keeping the note steady.",
          "Record again without pushing volume.",
        ],
      };
    }
  }

  return {
    focus: "timing",
    repeatCount: 2,
    steps: [
      "Tap the beat while reading the lyrics for 20 seconds.",
      "Sing the line with short consonants and clear starts twice.",
      "Record again and stay close to the reference pace.",
    ],
  };
}
