export type TimedWord = {
  word: string;
  start: number;
  end: number;
  lineIndex: number;
  wordIndex: number;
  refIndex?: number;
};

export type CalibrationMetrics = {
  rmsAvg: number;
  peak: number;
  noiseFloor: number;
  snrDb: number;
  clippingPct: number;
  sampleSec: number;
};

export type PracticeMode = "full" | "words" | "timing" | "pitch";

export type Verse = {
  index: number;
  text: string;
  lines: string[];
  startTime: number;
  endTime: number;
  words: TimedWord[];
};

export type LiveMeters = {
  pitch: number;
  timing: number;
  stability: number;
};

export type LiveScores = {
  overall: number;
  pitch: number;
  timing: number;
  stability: number;
  words?: number;
  label: string;
  tips: string[];
  practiceMode?: PracticeMode;
  detailed?: DetailedFeedback;
  alignment?: {
    timingCorrelation?: number;
    estimatedOffsetMs?: number;
  };
};

export type WordFeedbackStatus =
  | "correct"
  | "correct_early"
  | "correct_late"
  | "incorrect"
  | "missed"
  | "extra_ignored";

export type WordFeedback = {
  refIndex: number;
  refWord: string;
  refStart: number;
  refEnd: number;
  status: WordFeedbackStatus;
  userWord?: string;
  userStart?: number;
  userEnd?: number;
  deltaMs?: number;
  confidence?: number;
  confidenceLabel?: "High" | "Medium" | "Low";
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
  perWord: WordFeedback[];
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

export type CoachingHistoryPoint = {
  id: number;
  uploadId: number;
  verseIndex: number;
  verseCount: number;
  scores: {
    overall: number;
    pitch: number;
    timing: number;
    stability: number;
    words?: number;
    label: string;
  };
  tips: string[];
  focusLine?: string | null;
  focusAreas?: string[];
  practiceMode?: PracticeMode;
  debug?: Record<string, any> | null;
  createdAt: string;
};
