import type { AlignmentWordResult, WordToken } from "./alignment";
import { alignWords } from "./alignment";
import { normalizeToken } from "./normalize";

export type ReferenceLine = {
  index: number;
  text: string;
  start: number;
  end: number;
};

export type SegmentFeedback = {
  segmentIndex: number;
  text: string;
  start: number;
  end: number;
  wordAccuracyPct: number;
  timingMeanAbsMs: number;
  mainIssues: string[];
};

export type NextDrill = {
  type: "repeat_segment" | "slow_down" | "timing_lock" | "accuracy_clean";
  targetSegmentIndex?: number;
  repeatCount?: number;
  note: string;
};

export type DetailedFeedback = {
  wordAccuracyPct: number;
  timingMeanAbsMs: number;
  paceRatio: number;
  perWord: AlignmentWordResult[];
  segments: SegmentFeedback[];
  coachTips: string[];
  nextDrill: NextDrill;
  subscores: {
    wordAccuracy: number;
    timing: number;
    pace: number;
  };
  missedWords: string[];
  extraWords: string[];
  substitutions?: Array<{
    refWord: string;
    userWord: string;
    confidence?: number;
    confidenceLabel?: "High" | "Medium" | "Low";
  }>;
  confidenceLabel?: "High" | "Medium" | "Low";
  estimatedOffsetMs?: number;
  message?: string;
  warnings?: string[];
};

const DEFAULT_SEGMENT_WORDS = 10;
const TIMING_WARNING_MS = 250;
const MIN_SEGMENT_SEC = 0.6;
const PAUSE_GAP_SEC = 0.9;

function mergeShortSegments(segments: SegmentFeedback[]): SegmentFeedback[] {
  if (segments.length < 2) return segments;
  const merged: SegmentFeedback[] = [];
  segments.forEach((segment) => {
    if (merged.length === 0) {
      merged.push(segment);
      return;
    }
    const duration = segment.end - segment.start;
    if (duration < MIN_SEGMENT_SEC) {
      const prev = merged[merged.length - 1];
      prev.text = `${prev.text} ${segment.text}`.trim();
      prev.end = Math.max(prev.end, segment.end);
      return;
    }
    merged.push(segment);
  });
  return merged;
}

function buildSegmentsFromLines(
  referenceLines: ReferenceLine[],
  referenceWords: WordToken[]
): SegmentFeedback[] {
  return referenceLines.map((line) => {
    const words = referenceWords.filter((word) => word.lineIndex === line.index);
    const text = line.text?.trim() || words.map((word) => word.word).join(" ");
    const start = words[0]?.start ?? line.start;
    const end = words[words.length - 1]?.end ?? line.end;
    return {
      segmentIndex: line.index,
      text,
      start,
      end,
      wordAccuracyPct: 0,
      timingMeanAbsMs: 0,
      mainIssues: [],
    };
  });
}

function buildSegmentsFromWords(referenceWords: WordToken[]): SegmentFeedback[] {
  if (!referenceWords.length) return [];
  const segments: SegmentFeedback[] = [];
  let bucket: WordToken[] = [];
  let segmentIndex = 0;

  const flush = () => {
    if (!bucket.length) return;
    const text = bucket.map((word) => word.word).join(" ");
    segments.push({
      segmentIndex,
      text,
      start: bucket[0].start,
      end: bucket[bucket.length - 1].end,
      wordAccuracyPct: 0,
      timingMeanAbsMs: 0,
      mainIssues: [],
    });
    segmentIndex += 1;
    bucket = [];
  };

  bucket.push(referenceWords[0]);
  for (let i = 1; i < referenceWords.length; i += 1) {
    const word = referenceWords[i];
    const prev = bucket[bucket.length - 1];
    const gap = word.start - prev.end;
    if (gap > PAUSE_GAP_SEC) {
      flush();
      bucket.push(word);
      continue;
    }
    bucket.push(word);
    const endsSentence = /[.!?]$/.test(word.word);
    if (bucket.length >= DEFAULT_SEGMENT_WORDS || endsSentence) {
      flush();
    }
  }
  flush();
  return mergeShortSegments(segments);
}

function scoreTiming(timingMeanAbsMs: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - timingMeanAbsMs / 5)));
}

function scorePace(paceRatio: number): number {
  const delta = Math.abs(1 - paceRatio);
  return Math.max(0, Math.min(100, Math.round(100 - delta * 200)));
}

function buildSegmentIssues(
  segmentWords: AlignmentWordResult[],
  timingMeanAbsMs: number
): string[] {
  const issues: string[] = [];
  const missed = segmentWords.filter((word) => word.status === "missed").map((word) => word.refWord);
  const incorrect = segmentWords
    .filter((word) => word.status === "incorrect")
    .map((word) => word.refWord);
  if (missed.length) {
    issues.push(`Missed ${missed.slice(0, 4).join(", ")}.`);
  }
  if (incorrect.length && issues.length < 2) {
    issues.push(`Incorrect words: ${incorrect.slice(0, 4).join(", ")}.`);
  }
  if (timingMeanAbsMs > TIMING_WARNING_MS) {
    issues.push(`Timing off by ~${timingMeanAbsMs}ms.`);
  }
  if (!issues.length) {
    issues.push("Nice line. Keep the timing consistent.");
  }
  return issues;
}

export function buildDetailedFeedback(input: {
  referenceWords: WordToken[];
  userWords: WordToken[];
  referenceLines?: ReferenceLine[];
  verseStartSec: number;
  verseEndSec: number;
  estimatedOffsetMs?: number;
}): DetailedFeedback {
  const verseDuration = Math.max(0, input.verseEndSec - input.verseStartSec);
  const userDuration =
    input.userWords.length > 0
      ? Math.max(0, input.userWords[input.userWords.length - 1].end - input.userWords[0].start)
      : 0;

  const lastUserEnd = input.userWords.length > 0 ? input.userWords[input.userWords.length - 1].end : 0;
  const coveragePct = verseDuration > 0 ? lastUserEnd / verseDuration : 1;
  const coverageEnd = verseDuration > 0 ? Math.min(verseDuration, lastUserEnd + 0.5) : lastUserEnd;

  const coverageMessage =
    coveragePct < 0.6 ? "You stopped early-record the full verse to score it." : undefined;

  const referenceWords = coveragePct < 0.6
    ? input.referenceWords.filter((word) => word.start <= coverageEnd + 0.01)
    : input.referenceWords;

  const referenceLines = coveragePct < 0.6 && input.referenceLines
    ? input.referenceLines.filter((line) => line.start <= coverageEnd + 0.01)
    : input.referenceLines;

  const offsetSec =
    typeof input.estimatedOffsetMs === "number"
      ? input.estimatedOffsetMs / 1000
      : 0;
  const alignment = alignWords(referenceWords, input.userWords, {
    referenceOffsetSec: 0,
    userOffsetSec: offsetSec,
    referenceDurationSec: verseDuration,
    userDurationSec: userDuration,
  });

  const rawSegments =
    referenceLines && referenceLines.length > 0
      ? buildSegmentsFromLines(referenceLines, referenceWords)
      : buildSegmentsFromWords(referenceWords);
  const segments = mergeShortSegments(rawSegments);

  const perWordByRef = new Map(alignment.perWord.map((word) => [word.refIndex, word]));
  const segmentsWithScores = segments.map((segment) => {
    const segmentWords = referenceWords.filter(
      (word) => word.start >= segment.start && word.end <= segment.end + 0.01
    );
    const aligned = segmentWords
      .map((word) => perWordByRef.get(word.index))
      .filter((word): word is AlignmentWordResult => Boolean(word));

    const weightedCorrect = aligned.reduce((acc, word) => {
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
    const wordAccuracyPct = aligned.length
      ? Math.round((weightedCorrect / aligned.length) * 100)
      : 0;
    const timingSources = aligned.filter(
      (word) =>
        (word.status === "correct" ||
          word.status === "correct_early" ||
          word.status === "correct_late") &&
        typeof word.deltaMs === "number"
    );
    const timingMeanAbsMs = timingSources.length
      ? Math.round(
          timingSources.reduce((acc, word) => acc + Math.abs(word.deltaMs ?? 0), 0) /
            timingSources.length
        )
      : 0;

    return {
      ...segment,
      wordAccuracyPct,
      timingMeanAbsMs,
      mainIssues: buildSegmentIssues(aligned, timingMeanAbsMs),
    };
  });

  const worstSegment = segmentsWithScores.reduce(
    (worst, current) =>
      current.wordAccuracyPct < worst.wordAccuracyPct ? current : worst,
    segmentsWithScores[0] ?? {
      segmentIndex: 0,
      text: "",
      start: 0,
      end: 0,
      wordAccuracyPct: 100,
      timingMeanAbsMs: 0,
      mainIssues: [],
    }
  );

  const paceRatio = alignment.metrics.paceRatio || 1;
  const timingMeanAbsMs = alignment.metrics.timingMeanAbsMs;
  const weightedWordAccuracy = alignment.perWord.reduce((acc, word) => {
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
  const wordAccuracyPct = alignment.perWord.length
    ? Math.round((weightedWordAccuracy / alignment.perWord.length) * 100)
    : alignment.metrics.wordAccuracyPct;
  const coachTips: string[] = [];

  if (wordAccuracyPct < 75) {
    const missed = alignment.metrics.missedWords.slice(0, 5).join(", ");
    coachTips.push(
      missed
        ? `Focus on the missed words: ${missed}.`
        : "Focus on lyric accuracy - keep the words tight."
    );
  }
  if (timingMeanAbsMs > TIMING_WARNING_MS) {
    const offsetNote =
      typeof input.estimatedOffsetMs === "number" && Math.abs(input.estimatedOffsetMs) > 40
        ? ` (offset corrected by ${Math.round(input.estimatedOffsetMs)}ms)`
        : "";
    coachTips.push(
      `Timing is off by about ${timingMeanAbsMs}ms${offsetNote}. Lock into the reference cue.`
    );
  }
  if (paceRatio > 1.12) {
    coachTips.push("You're rushing this verse. Slow down slightly and match the phrasing.");
  }
  if (paceRatio < 0.88) {
    coachTips.push("You're dragging a bit. Push forward to match the reference pace.");
  }
  if (!coachTips.length) {
    coachTips.push("Nice take - aim for even tighter timing on the next pass.");
  }

  let nextDrill: NextDrill = {
    type: "accuracy_clean",
    note: "Repeat the verse focusing on clean word delivery.",
  };
  if (worstSegment.wordAccuracyPct < 70) {
    nextDrill = {
      type: "repeat_segment",
      targetSegmentIndex: worstSegment.segmentIndex,
      repeatCount: 3,
      note: `Repeat the weakest line (${worstSegment.segmentIndex + 1}) three times for clarity.`,
    };
  } else if (timingMeanAbsMs > TIMING_WARNING_MS) {
    nextDrill = {
      type: "timing_lock",
      note: "Clap the beat, then sing the line to lock timing.",
    };
  } else if (paceRatio > 1.12) {
    nextDrill = {
      type: "slow_down",
      note: "Slow the verse slightly and land the word starts on the beat.",
    };
  }

  const wordAccuracyScore = Math.max(0, Math.min(100, Math.round(wordAccuracyPct)));
  const timingScore = scoreTiming(timingMeanAbsMs);
  const paceScore = scorePace(paceRatio);

  const substitutions =
    alignment.perWord
      .filter((word) => word.status === "incorrect" && word.userWord)
      .map((word) => ({
        refWord: word.refWord,
        userWord: word.userWord ?? "",
        confidence: word.confidence,
        confidenceLabel: word.confidenceLabel,
      })) ?? [];

  const confidenceValues = alignment.perWord
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number");
  const averageConfidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((acc, value) => acc + value, 0) / confidenceValues.length
      : 0;
  const confidenceLabel =
    averageConfidence >= 0.78 ? "High" : averageConfidence >= 0.5 ? "Medium" : "Low";
  const warnings: string[] = [];
  if (confidenceLabel === "Low") {
    warnings.push("Low transcription confidence; word penalties softened.");
  }

  return {
    wordAccuracyPct,
    timingMeanAbsMs,
    paceRatio,
    perWord: alignment.perWord,
    segments: segmentsWithScores,
    coachTips,
    nextDrill,
    subscores: {
      wordAccuracy: wordAccuracyScore,
      timing: timingScore,
      pace: paceScore,
    },
    missedWords: alignment.metrics.missedWords.map((word) => normalizeToken(word)).filter(Boolean),
    extraWords: alignment.metrics.extraWords.map((word) => normalizeToken(word)).filter(Boolean),
    substitutions,
    confidenceLabel,
    estimatedOffsetMs: input.estimatedOffsetMs,
    warnings: warnings.length ? warnings : undefined,
    ...(coverageMessage ? { message: coverageMessage } : {}),
  };
}
