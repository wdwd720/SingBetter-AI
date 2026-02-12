import type { PitchCoach } from "./coachPitch";
import type { WordCoach } from "./coachWords";
import type { DictionCoach } from "./diction";
import type { NoteCoach } from "./notePitch";
import type { BreathCoach } from "./breathCoach";

export type FocusLine = {
  index: number;
  text: string;
  source: "pitch" | "timing" | "lyrics" | "diction" | "notes" | "breath";
};

export type CoachPriorityResult = {
  topIssues: string[];
  summary: string;
  focusLine?: FocusLine;
};

type CoachPriorityInput = {
  pitchCoach?: PitchCoach | null;
  wordCoach?: WordCoach | null;
  dictionCoach?: DictionCoach | null;
  noteCoach?: NoteCoach | null;
  breathCoach?: BreathCoach | null;
  timingMeanAbsMs?: number | null;
  paceRatio?: number | null;
  focusLine?: FocusLine | null;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function buildCoachPriority({
  pitchCoach,
  wordCoach,
  dictionCoach,
  noteCoach,
  breathCoach,
  timingMeanAbsMs,
  paceRatio,
  focusLine,
}: CoachPriorityInput): CoachPriorityResult {
  if (pitchCoach?.lowConfidence || dictionCoach?.lowConfidence) {
    return {
      topIssues: ["Recording quality"],
      summary:
        "We could not detect enough clear voice to score pitch reliably. Try again closer to the mic with less background audio.",
      ...(focusLine ? { focusLine } : {}),
    };
  }

  const issues: string[] = [];
  const wordAccuracy = wordCoach?.wordAccuracyScore ?? 100;
  const dictionClarity = dictionCoach?.clarityScore ?? 100;
  const noteAccuracy = noteCoach?.noteAccuracyScore ?? 100;
  const pitchAccuracy = pitchCoach?.pitchAccuracyScore ?? 100;
  const pitchStability = pitchCoach?.pitchStabilityScore ?? 100;
  const breathScore = breathCoach?.phrasingScore ?? 100;
  const timingMs = timingMeanAbsMs ?? 0;
  const pace = paceRatio ?? 1;

  if (wordAccuracy < 70) issues.push("Lyrics clarity");
  else if (dictionClarity < 60) issues.push("Diction clarity");
  else if (noteAccuracy < 60) issues.push("Note intonation");
  else if (pitchAccuracy < 60) issues.push("Pitch accuracy");
  else if (pitchStability < 55) issues.push("Pitch stability");
  else if (timingMs > 350) issues.push("Timing/entrance");
  else if (pace > 1.12) issues.push("Rushing pace");
  else if (pace < 0.88) issues.push("Dragging pace");

  if (breathScore < 65 && issues.length < 3) issues.push("Breath control");

  const topIssues = issues.slice(0, 3);

  const sentences: string[] = [];

  if (topIssues.includes("Lyrics clarity")) {
    const missed = wordCoach?.missedWords?.slice(0, 3) ?? [];
    sentences.push(
      missed.length
        ? `Lyrics accuracy is the main focus - you missed ${missed
            .map((word) => `'${word}'`)
            .join(", ")}.`
        : "Lyrics accuracy is the main focus - aim to land every word clearly."
    );
  }

  if (topIssues.includes("Diction clarity")) {
    sentences.push("Diction is unclear on a few words - exaggerate consonants and keep the vowel shape.");
  }

  if (topIssues.includes("Note intonation")) {
    const worst = noteCoach?.worstNotes?.[0];
    if (worst) {
      sentences.push(
        `Intonation slips on ${worst.note} by about ${Math.abs(worst.centsOff)} cents.`
      );
    } else {
      sentences.push("Intonation needs attention - land the note cleanly before adding vibrato.");
    }
  }

  if (topIssues.includes("Pitch accuracy")) {
    if (pitchCoach && pitchCoach.compareAvailable && Math.abs(pitchCoach.biasCents) > 25) {
      sentences.push(
        `Pitch accuracy needs attention - you are ${pitchCoach.biasCents > 0 ? "sharp" : "flat"} by about ${Math.abs(
          pitchCoach.biasCents
        )} cents.`
      );
    } else {
      sentences.push("Pitch accuracy needs attention - aim to land the target note sooner.");
    }
  }

  if (topIssues.includes("Pitch stability")) {
    sentences.push("Pitch stability is uneven - keep long notes steady and supported.");
  }

  if (topIssues.includes("Timing/entrance")) {
    sentences.push(`Timing is loose - average offset is about ${Math.round(clamp(timingMs, 0, 2000))}ms.`);
  }

  if (topIssues.includes("Rushing pace")) {
    sentences.push("You are rushing the phrase - slow the pace slightly.");
  }

  if (topIssues.includes("Dragging pace")) {
    sentences.push("You are dragging the phrase - push forward to match the reference.");
  }

  if (topIssues.includes("Breath control")) {
    sentences.push("Phrase endings drop early - support airflow through the last word.");
  }

  if (focusLine && focusLine.text) {
    const label =
      focusLine.index >= 0 ? `Focus line ${focusLine.index + 1}` : "Focus phrase";
    sentences.push(`${label}: "${focusLine.text}".`);
  }

  if (sentences.length === 0) {
    sentences.push("Nice take. Keep the timing tight and words clean.");
  }

  if (sentences.length < 2) {
    sentences.push("Stay relaxed and focus on clear word starts.");
  }

  const summary = sentences.slice(0, 3).join(" ");

  return {
    topIssues,
    summary,
    ...(focusLine ? { focusLine } : {}),
  };
}
