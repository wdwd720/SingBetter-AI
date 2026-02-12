import type { DetailedFeedback, LiveScores } from "@/components/live-coaching/types";
import type { PitchCoach } from "./coachPitch";
import type { DictionCoach } from "./diction";
import type { NoteCoach } from "./notePitch";
import type { BreathCoach } from "./breathCoach";

export type FocusType = "pitch" | "timing" | "words" | "diction" | "breath" | "notes";

export type DrillSession = {
  id: string;
  createdAt: number;
  focus: FocusType;
  title: string;
  targetLineIndex?: number;
  targetSegmentIndex?: number;
  repeatCount: number;
  currentRep: number;
  passCondition: {
    metric: string;
    goodDirection: "down" | "up";
    threshold?: number;
    improveBy?: number;
    minVoicedPct?: number;
  };
  reps: RepResult[];
  status: "active" | "passed" | "failed";
};

export type RepResult = {
  rep: number;
  attemptId?: number;
  timestamp: number;
  metrics: Record<string, number | null>;
  summary: string;
  pass: boolean;
};

export type UnifiedMetrics = {
  timingMeanAbsMs: number | null;
  timingCorrelation: number | null;
  paceRatio: number | null;
  wordAccuracyPct: number | null;
  coveragePct: number | null;
  biasCents: number | null;
  medianAbsErrorCents: number | null;
  pctWithin50Cents: number | null;
  voicedPct: number | null;
  pitchAccuracyScore: number | null;
  pitchStabilityScore: number | null;
  dictionClarityScore: number | null;
  dictionLowConfidence: number | null;
  noteAccuracyScore: number | null;
  noteBiasCents: number | null;
  phrasingScore: number | null;
  extraBreathsCount: number | null;
  tailDropCount: number | null;
  missedWordsCount: number | null;
  extraWordsCount: number | null;
};

export type FocusSelection = {
  focus: FocusType;
  title: string;
  targetLineIndex?: number;
  targetSegmentIndex?: number;
};

// Drill thresholds (deterministic, shared across UI + pass logic)
export const DRILL_DEFAULT_REPEAT = 3;
export const WORD_ACCURACY_TARGET = 80;
export const WORD_ACCURACY_IMPROVE = 10;
export const TIMING_TARGET_MS = 220;
export const TIMING_IMPROVE_MS = 80;
export const TIMING_EXTREME_MS = 650;
export const PITCH_TARGET_CENTS = 45;
export const PITCH_IMPROVE_CENTS = 15;
export const PITCH_BIAS_THRESHOLD = 35;
export const PITCH_BIAS_IMPROVE = 10;
export const PITCH_MIN_VOICED = 0.55;
export const DICTION_TARGET = 55;
export const DICTION_IMPROVE = 12;
export const BREATH_TARGET = 65;
export const BREATH_IMPROVE = 10;
export const NOTES_TARGET = 70;
export const NOTES_IMPROVE = 10;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const buildId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `drill-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const METRIC_LABELS: Record<string, string> = {
  wordAccuracyPct: "Word accuracy",
  timingMeanAbsMs: "Timing",
  medianAbsErrorCents: "Pitch error",
  dictionClarityScore: "Diction clarity",
  phrasingScore: "Breath score",
  noteAccuracyScore: "Note accuracy",
};

const safeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const getCoverageFromPerWord = (detailed: DetailedFeedback, segmentDurationSec?: number | null) => {
  if (!segmentDurationSec || segmentDurationSec <= 0) return null;
  const lastUserEnd = detailed.perWord.reduce((max, word) => {
    const value = typeof word.userEnd === "number" ? word.userEnd : word.userStart;
    if (typeof value === "number") return Math.max(max, value);
    return max;
  }, 0);
  return lastUserEnd > 0 ? clamp(lastUserEnd / segmentDurationSec, 0, 1) : null;
};

export function extractUnifiedMetrics(input: {
  scores?: LiveScores | null;
  detailed?: DetailedFeedback | null;
  pitchCoach?: PitchCoach | null;
  noteCoach?: NoteCoach | null;
  dictionCoach?: DictionCoach | null;
  breathCoach?: BreathCoach | null;
  segmentDurationSec?: number | null;
}): UnifiedMetrics {
  const detailed = input.detailed ?? input.scores?.detailed ?? null;
  const detailedAny = detailed as any;
  const coveragePct =
    safeNumber(detailedAny?.coveragePct) ??
    (detailed ? getCoverageFromPerWord(detailed, input.segmentDurationSec) : null);

  return {
    timingMeanAbsMs: safeNumber(detailed?.timingMeanAbsMs),
    timingCorrelation: safeNumber(input.scores?.alignment?.timingCorrelation),
    paceRatio: safeNumber(detailed?.paceRatio),
    wordAccuracyPct: safeNumber(detailed?.wordAccuracyPct),
    coveragePct,
    biasCents: safeNumber(input.pitchCoach?.biasCents),
    medianAbsErrorCents: safeNumber(input.pitchCoach?.medianAbsErrorCents),
    pctWithin50Cents: safeNumber((input.pitchCoach as any)?.pctWithin50Cents),
    voicedPct: safeNumber(input.pitchCoach?.voicedPct),
    pitchAccuracyScore: safeNumber(input.pitchCoach?.pitchAccuracyScore),
    pitchStabilityScore: safeNumber(input.pitchCoach?.pitchStabilityScore),
    dictionClarityScore: safeNumber(input.dictionCoach?.clarityScore),
    dictionLowConfidence: input.dictionCoach?.lowConfidence ? 1 : 0,
    noteAccuracyScore: safeNumber(input.noteCoach?.noteAccuracyScore),
    noteBiasCents: safeNumber((input.noteCoach as any)?.debug?.bias),
    phrasingScore: safeNumber(input.breathCoach?.phrasingScore),
    extraBreathsCount: safeNumber((input.breathCoach as any)?.debug?.extraBreaths),
    tailDropCount: safeNumber((input.breathCoach as any)?.debug?.tailDrops),
    missedWordsCount: detailed?.missedWords?.length ?? null,
    extraWordsCount: detailed?.extraWords?.length ?? null,
  };
}

export function selectDrillFocus(input: {
  metrics: UnifiedMetrics;
  detailed?: DetailedFeedback | null;
  pitchCoach?: PitchCoach | null;
  dictionCoach?: DictionCoach | null;
  noteCoach?: NoteCoach | null;
  breathCoach?: BreathCoach | null;
  focusLineIndex?: number | null;
  practiceMode?: "full" | "words" | "timing" | "pitch";
  avoidFocus?: FocusType | null;
}): FocusSelection {
  const metrics = input.metrics;
  const wordAccuracy = metrics.wordAccuracyPct ?? 100;
  const timingMs = metrics.timingMeanAbsMs ?? 0;
  const biasCents = metrics.biasCents ?? 0;
  const medianAbsError = metrics.medianAbsErrorCents ?? 0;
  const dictionScore = metrics.dictionClarityScore ?? 100;
  const breathScore = metrics.phrasingScore ?? 100;
  const lowConfidence =
    Boolean(input.pitchCoach?.lowConfidence) ||
    Boolean(input.dictionCoach?.lowConfidence) ||
    (metrics.voicedPct !== null && metrics.voicedPct < 0.35);

  const worstAccuracySegment = input.detailed?.segments?.reduce(
    (worst, current) => (current.wordAccuracyPct < worst.wordAccuracyPct ? current : worst),
    input.detailed?.segments?.[0]
  );
  const worstTimingSegment = input.detailed?.segments?.reduce(
    (worst, current) => (current.timingMeanAbsMs > worst.timingMeanAbsMs ? current : worst),
    input.detailed?.segments?.[0]
  );

  let focus: FocusType = "pitch";
  const avoid = input.avoidFocus ?? null;
  const preferredByMode: FocusType[] =
    input.practiceMode === "words"
      ? ["words", "timing", "pitch"]
      : input.practiceMode === "timing"
        ? ["timing", "words", "pitch"]
        : input.practiceMode === "pitch"
          ? ["pitch", "notes", "timing"]
          : ["pitch", "timing", "words", "diction", "breath", "notes"];

  if (input.practiceMode && input.practiceMode !== "full") {
    focus = preferredByMode.find((candidate) => candidate !== avoid) ?? "pitch";
  } else {

    if (lowConfidence) {
      focus = wordAccuracy < 75 ? "words" : "timing";
    } else if (wordAccuracy < 75 && timingMs <= TIMING_EXTREME_MS) {
      focus = "words";
    } else if (timingMs > 300) {
      focus = "timing";
    } else if (medianAbsError > 60 || Math.abs(biasCents) > PITCH_BIAS_THRESHOLD) {
      focus = "pitch";
    } else if (dictionScore < 45) {
      focus = "diction";
    } else if (breathScore < 55) {
      focus = "breath";
    } else {
      focus = input.noteCoach?.noteAccuracyScore ? "notes" : "pitch";
    }
  }

  if (avoid && focus === avoid) {
    focus = preferredByMode.find((candidate) => candidate !== avoid) ?? focus;
  }

  let title = "Focus drill";
  if (focus === "words") title = "Clean missed words";
  if (focus === "timing") title = timingMs > 420 ? "Fix rushed entrances" : "Tighten timing";
  if (focus === "pitch") {
    if (biasCents > PITCH_BIAS_THRESHOLD) title = "Fix sharp bias";
    else if (biasCents < -PITCH_BIAS_THRESHOLD) title = "Fix flat bias";
    else title = "Lock pitch accuracy";
  }
  if (focus === "diction") title = "Crisper consonants";
  if (focus === "breath") title = "Support phrase endings";
  if (focus === "notes") title = "Tune target notes";

  return {
    focus,
    title,
    targetLineIndex: input.focusLineIndex ?? input.pitchCoach?.worstLines?.[0]?.lineIndex,
    targetSegmentIndex:
      focus === "timing" ? worstTimingSegment?.segmentIndex : worstAccuracySegment?.segmentIndex,
  };
}

const getPassCondition = (focus: FocusType): DrillSession["passCondition"] => {
  switch (focus) {
    case "words":
      return {
        metric: "wordAccuracyPct",
        goodDirection: "up",
        threshold: WORD_ACCURACY_TARGET,
        improveBy: WORD_ACCURACY_IMPROVE,
      };
    case "timing":
      return {
        metric: "timingMeanAbsMs",
        goodDirection: "down",
        threshold: TIMING_TARGET_MS,
        improveBy: TIMING_IMPROVE_MS,
      };
    case "pitch":
      return {
        metric: "medianAbsErrorCents",
        goodDirection: "down",
        threshold: PITCH_TARGET_CENTS,
        improveBy: PITCH_IMPROVE_CENTS,
        minVoicedPct: PITCH_MIN_VOICED,
      };
    case "diction":
      return {
        metric: "dictionClarityScore",
        goodDirection: "up",
        threshold: DICTION_TARGET,
        improveBy: DICTION_IMPROVE,
      };
    case "breath":
      return {
        metric: "phrasingScore",
        goodDirection: "up",
        threshold: BREATH_TARGET,
        improveBy: BREATH_IMPROVE,
      };
    case "notes":
      return {
        metric: "noteAccuracyScore",
        goodDirection: "up",
        threshold: NOTES_TARGET,
        improveBy: NOTES_IMPROVE,
      };
    default:
      return {
        metric: "timingMeanAbsMs",
        goodDirection: "down",
        threshold: TIMING_TARGET_MS,
        improveBy: TIMING_IMPROVE_MS,
      };
  }
};

export function createDrillSession(
  selection: FocusSelection,
  repeatCount = DRILL_DEFAULT_REPEAT
): DrillSession {
  return {
    id: buildId(),
    createdAt: Date.now(),
    focus: selection.focus,
    title: selection.title,
    targetLineIndex: selection.targetLineIndex,
    targetSegmentIndex: selection.targetSegmentIndex,
    repeatCount,
    currentRep: 0,
    passCondition: getPassCondition(selection.focus),
    reps: [],
    status: "active",
  };
}

const formatValue = (metric: string, value: number) => {
  if (metric.includes("Ms")) return `${Math.round(value)}ms`;
  if (metric.includes("Cents")) return `${Math.round(value)}c`;
  if (metric.includes("Pct") || metric.includes("Score")) return `${Math.round(value)}%`;
  return `${Math.round(value)}`;
};

const evaluatePass = (session: DrillSession, metrics: UnifiedMetrics) => {
  const { passCondition, focus } = session;
  const current = metrics[passCondition.metric as keyof UnifiedMetrics];
  const baseline = session.reps[0]?.metrics?.[passCondition.metric] ?? null;

  if (passCondition.minVoicedPct && (metrics.voicedPct ?? 0) < passCondition.minVoicedPct) {
    return { pass: false, summary: "Not enough clear voice detected." };
  }

  if (focus === "timing" && (metrics.coveragePct ?? 1) < 0.6) {
    return { pass: false, summary: "You stopped early - record the full line." };
  }

  if (focus === "diction" && metrics.dictionLowConfidence === 1) {
    return { pass: false, summary: "Audio too soft for diction scoring." };
  }

  let pass = false;
  if (typeof current === "number") {
    const threshold = passCondition.threshold;
    const improveBy = passCondition.improveBy;
    const meetsThreshold =
      typeof threshold === "number"
        ? passCondition.goodDirection === "down"
          ? current <= threshold
          : current >= threshold
        : false;
    const improved =
      typeof improveBy === "number" && typeof baseline === "number"
        ? passCondition.goodDirection === "down"
          ? baseline - current >= improveBy
          : current - baseline >= improveBy
        : false;
    pass = meetsThreshold || improved;
  }

  if (focus === "words") {
    const baseMissed = session.reps[0]?.metrics.missedWordsCount ?? null;
    const baseExtra = session.reps[0]?.metrics.extraWordsCount ?? null;
    const missedReduced =
      typeof baseMissed === "number" && typeof metrics.missedWordsCount === "number"
        ? metrics.missedWordsCount < baseMissed
        : false;
    const extraReduced =
      typeof baseExtra === "number" && typeof metrics.extraWordsCount === "number"
        ? metrics.extraWordsCount < baseExtra
        : false;
    if ((baseMissed !== null || baseExtra !== null) && !missedReduced && !extraReduced) {
      pass = false;
    }
  }

  if (focus === "pitch") {
    const biasNow = metrics.biasCents;
    const biasBase = session.reps[0]?.metrics.biasCents ?? null;
    if (typeof biasNow === "number" && Math.abs(biasNow) > PITCH_BIAS_THRESHOLD) {
      const improved =
        typeof biasBase === "number"
          ? Math.abs(biasNow) <= Math.abs(biasBase) - PITCH_BIAS_IMPROVE
          : Math.abs(biasNow) <= PITCH_BIAS_THRESHOLD;
      if (!improved) pass = false;
    }
  }

  return { pass, summary: "" };
};

const buildSummary = (session: DrillSession, metrics: UnifiedMetrics) => {
  const focus = session.focus;
  if (focus === "words" && metrics.missedWordsCount !== null) {
    return `Words missed: ${metrics.missedWordsCount}`;
  }
  const key = session.passCondition.metric;
  const value = metrics[key as keyof UnifiedMetrics];
  if (typeof value !== "number") return "Rep recorded.";
  return `${METRIC_LABELS[key] ?? key}: ${formatValue(key, value)}`;
};

export function appendDrillRep(session: DrillSession, metrics: UnifiedMetrics): DrillSession {
  const repNumber = session.reps.length + 1;
  const { pass, summary } = evaluatePass(session, metrics);
  const rep: RepResult = {
    rep: repNumber,
    timestamp: Date.now(),
    metrics: metrics as Record<string, number | null>,
    summary: summary || buildSummary(session, metrics),
    pass,
  };

  const reps = [...session.reps, rep];
  const status = pass ? "passed" : repNumber >= session.repeatCount ? "failed" : "active";

  return {
    ...session,
    reps,
    currentRep: Math.min(repNumber, session.repeatCount),
    status,
  };
}

export function buildRepDelta(session: DrillSession): string | null {
  if (!session.reps.length) return null;
  const focus = session.focus;
  const current = session.reps[session.reps.length - 1];
  const previous = session.reps.length > 1 ? session.reps[session.reps.length - 2] : null;

  if (focus === "words" && typeof current.metrics.missedWordsCount === "number") {
    const label = "Words missed";
    if (previous && typeof previous.metrics.missedWordsCount === "number") {
      return `${label}: ${previous.metrics.missedWordsCount} → ${current.metrics.missedWordsCount}`;
    }
    return `${label}: ${current.metrics.missedWordsCount}`;
  }

  const key = session.passCondition.metric;
  const currentValue = current.metrics[key];
  if (typeof currentValue !== "number") return null;
  const label = METRIC_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").trim();
  if (previous && typeof previous.metrics[key] === "number") {
    return `${label}: ${formatValue(key, previous.metrics[key] as number)} → ${formatValue(
      key,
      currentValue
    )}`;
  }
  return `${label}: ${formatValue(key, currentValue)}`;
}

export function formatPassCondition(session: DrillSession): string {
  const { metric, goodDirection, threshold, improveBy, minVoicedPct } = session.passCondition;
  const label = METRIC_LABELS[metric] ?? metric.replace(/([A-Z])/g, " $1").trim();
  const goalParts: string[] = [];
  if (typeof threshold === "number") {
    const symbol = goodDirection === "down" ? "<" : "≥";
    goalParts.push(`${label} ${symbol} ${formatValue(metric, threshold)}`);
  }
  if (typeof improveBy === "number") {
    const directionLabel = goodDirection === "down" ? "improve by" : "increase by";
    goalParts.push(`${directionLabel} ${formatValue(metric, improveBy)}`);
  }
  if (typeof minVoicedPct === "number") {
    goalParts.push(`voiced ≥ ${Math.round(minVoicedPct * 100)}%`);
  }
  return goalParts.join(" or ");
}
