import type { CoachCoreResult } from "./coachCore";
import type { DictionCoach } from "./diction";
import type { NoteCoach } from "./notePitch";
import type { WordCoach } from "./coachWords";
import type { PitchCoach } from "./coachPitch";
import type { BreathCoach } from "./breathCoach";

export type CoachCard = {
  key: string;
  title: string;
  score?: number;
  items?: string[];
  tips?: string[];
  drill?: {
    title: string;
    steps: string[];
    repeatCount?: number;
    targetLineIndex?: number;
  };
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function buildCoachCards(input: {
  dictionCoach?: DictionCoach | null;
  noteCoach?: NoteCoach | null;
  wordCoach?: WordCoach | null;
  pitchCoach?: PitchCoach | null;
  breathCoach?: BreathCoach | null;
  coachCore?: CoachCoreResult | null;
}): CoachCard[] {
  const {
    dictionCoach,
    noteCoach,
    wordCoach,
    pitchCoach,
    breathCoach,
    coachCore,
  } = input;

  const lowConfidence = dictionCoach?.lowConfidence || pitchCoach?.lowConfidence;

  if (lowConfidence) {
    return [
      {
        key: "recording",
        title: "Recording Quality",
        score: 0,
        tips: [
          "Move closer to the mic and reduce background music.",
          "Sing at a steady volume for at least 3 seconds.",
        ],
      },
    ];
  }

  const candidates: Array<{ priority: number; card: CoachCard }> = [];

  if (dictionCoach && !dictionCoach.lowConfidence) {
    candidates.push({
      priority: clamp(100 - dictionCoach.clarityScore, 0, 100),
      card: {
        key: "diction",
        title: "Diction & Clarity",
        score: dictionCoach.clarityScore,
        items: dictionCoach.worstWords.map((word) => word.word).slice(0, 4),
        tips: dictionCoach.tips,
        drill: dictionCoach.drill,
      },
    });
  }

  if (noteCoach && (noteCoach.worstNotes.length > 0 || noteCoach.noteAccuracyScore > 0)) {
    candidates.push({
      priority: clamp(100 - noteCoach.noteAccuracyScore, 0, 100),
      card: {
        key: "notes",
        title: "Notes & Intonation",
        score: noteCoach.noteAccuracyScore,
        items: noteCoach.worstNotes.map((note) => `${note.note} (${note.centsOff}c)`),
        tips: noteCoach.tips,
        drill: noteCoach.drill,
      },
    });
  }

  if (wordCoach && wordCoach.wordAccuracyScore < 90) {
    candidates.push({
      priority: clamp(100 - wordCoach.wordAccuracyScore, 0, 100),
      card: {
        key: "words",
        title: "Words & Accuracy",
        score: wordCoach.wordAccuracyScore,
        items: [...wordCoach.missedWords, ...wordCoach.extraWords].slice(0, 4),
        tips: wordCoach.tips,
      },
    });
  }

  if (breathCoach && !breathCoach.lowConfidence) {
    candidates.push({
      priority: clamp(100 - breathCoach.phrasingScore, 0, 100),
      card: {
        key: "breath",
        title: "Breath & Phrasing",
        score: breathCoach.phrasingScore,
        items: breathCoach.issues,
        tips: breathCoach.tips,
        drill: breathCoach.drill,
      },
    });
  }

  if (coachCore?.timingMetrics && coachCore.timingMetrics.meanAbsDeltaMs > 200) {
    candidates.push({
      priority: clamp((coachCore.timingMetrics.meanAbsDeltaMs - 120) / 3, 0, 100),
      card: {
        key: "timing",
        title: "Timing Tightness",
        score: coachCore.subscores.timing,
        items: [
          `Avg +/- ${coachCore.timingMetrics.meanAbsDeltaMs}ms`,
          `${Math.round(coachCore.timingMetrics.within120Pct * 100)}% within 120ms`,
        ],
        tips: coachCore.tips,
        drill: coachCore.drill
          ? {
              title: "Timing drill",
              steps: [coachCore.drill.note],
              repeatCount: 2,
            }
          : undefined,
      },
    });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, 2).map((candidate) => candidate.card);
}
