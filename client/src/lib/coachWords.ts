import type { SegmentFeedback, WordFeedback } from "@/components/live-coaching/types";

export type WordCoach = {
  missedWords: string[];
  extraWords: string[];
  rushedPhrases: string[];
  latePhrases: string[];
  wordAccuracyScore: number;
  tips: string[];
};

type BuildWordCoachInput = {
  perWord: WordFeedback[];
  segments?: SegmentFeedback[];
  missedWords?: string[];
  extraWords?: string[];
};

const normalizeToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const uniqueLimited = (values: string[], limit: number) => {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeToken(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(value);
  });
  return output.slice(0, limit);
};

export function buildWordCoach({
  perWord,
  segments,
  missedWords,
  extraWords,
}: BuildWordCoachInput): WordCoach {
  const total = perWord.length;
  const weightedCorrect = perWord.reduce((acc, word) => {
    if (
      word.status === "correct" ||
      word.status === "correct_early" ||
      word.status === "correct_late"
    ) {
      return acc + 1;
    }
    if (word.status === "incorrect" && typeof word.confidence === "number" && word.confidence < 0.45) {
      return acc + 0.5;
    }
    return acc;
  }, 0);
  const wordAccuracyScore = total ? Math.round((weightedCorrect / total) * 100) : 0;

  const missed =
    missedWords && missedWords.length > 0
      ? missedWords
      : perWord
          .filter(
            (word) =>
              word.status === "missed" ||
              (word.status === "incorrect" &&
                (typeof word.confidence !== "number" || word.confidence >= 0.45))
          )
          .map((word) => word.refWord);
  const extras =
    extraWords && extraWords.length > 0
      ? extraWords
      : perWord
          .filter((word) => word.status === "extra_ignored")
          .map((word) => word.userWord || "");

  const missedLimited = uniqueLimited(missed, 5);
  const extraLimited = uniqueLimited(extras, 3);

  const rushedPhrases: string[] = [];
  const latePhrases: string[] = [];

  if (segments && segments.length > 0) {
    segments.forEach((segment) => {
      const windowWords = perWord.filter(
        (word) => word.refStart >= segment.start && word.refEnd <= segment.end + 0.01
      );
      const deltas = windowWords
        .filter((word) =>
          word.status === "correct" ||
          word.status === "correct_early" ||
          word.status === "correct_late"
        )
        .map((word) => word.deltaMs)
        .filter((value): value is number => typeof value === "number");
      if (deltas.length === 0) return;
      const avgDelta =
        deltas.reduce((acc, val) => acc + val, 0) / deltas.length;
      if (avgDelta < -250 && segment.text) {
        rushedPhrases.push(segment.text);
      } else if (avgDelta > 250 && segment.text) {
        latePhrases.push(segment.text);
      }
    });
  }

  const tips: string[] = [];

  if (missedLimited.length > 0) {
    tips.push(`You skipped ${missedLimited.map((word) => `'${word}'`).join(" and ")}.`);
  }
  if (extraLimited.length > 0) {
    tips.push(`You added extra words like ${extraLimited.map((word) => `'${word}'`).join(" and ")}.`);
  }
  if (rushedPhrases.length > 0) {
    tips.push(`You rushed the phrase "${rushedPhrases[0]}".`);
  }
  if (latePhrases.length > 0) {
    tips.push(`You came in late on "${latePhrases[0]}".`);
  }

  if (tips.length < 2) {
    tips.push("Enter words right on the beat and keep consonants clear.");
  }
  if (tips.length < 2) {
    tips.push("Speak the line once in rhythm, then sing it again.");
  }

  return {
    missedWords: missedLimited,
    extraWords: extraLimited,
    rushedPhrases: uniqueLimited(rushedPhrases, 3),
    latePhrases: uniqueLimited(latePhrases, 3),
    wordAccuracyScore,
    tips: tips.slice(0, 4),
  };
}
