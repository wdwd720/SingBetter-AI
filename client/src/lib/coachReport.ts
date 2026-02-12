import type { DetailedFeedback, PracticeMode } from "@/components/live-coaching/types";
import type { CoachPriorityResult } from "./coachPriority";
import type { DrillPlan } from "./coachDrills";
import type { CoachCoreResult } from "./coachCore";

export type CoachReport = {
  topIssues: string[];
  focusLine?: CoachPriorityResult["focusLine"];
  microDrills: string[];
  macroDrill: string;
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const buildMacroDrill = (mode: PracticeMode, focusLine?: string) => {
  const focusHint = focusLine ? ` Focus on "${focusLine}".` : "";
  if (mode === "words") {
    return `Speak the full verse in rhythm twice, then sing once with the real words.${focusHint}`;
  }
  if (mode === "timing") {
    return `Clap the beat for 10 seconds, then sing the full verse landing consonants on the beat.${focusHint}`;
  }
  if (mode === "pitch") {
    return `Hum the verse melody on "ng" once, then sing the full verse with steady pitch.${focusHint}`;
  }
  return `Run the full verse once with the top issue in mind.${focusHint}`;
};

export function buildCoachReport(input: {
  coachPriority?: CoachPriorityResult | null;
  coachCore?: CoachCoreResult | null;
  drillPlan?: DrillPlan | null;
  detailed?: DetailedFeedback | null;
  practiceMode: PracticeMode;
}): CoachReport {
  const topIssues =
    input.coachPriority?.topIssues?.length
      ? input.coachPriority.topIssues
      : input.coachCore?.topIssues ?? [];

  const focusLine = input.coachPriority?.focusLine;
  const focusLineText = focusLine?.text ?? "";

  const planSteps = input.drillPlan?.steps ?? [];
  const coachTips = input.detailed?.coachTips ?? input.coachCore?.tips ?? [];

  const microDrills = unique([
    planSteps[0],
    planSteps[1],
    coachTips[0],
    coachTips[1],
  ]).slice(0, 2);

  if (microDrills.length < 2) {
    microDrills.push("Record again focusing on clear starts and steady tempo.");
  }

  return {
    topIssues: topIssues.slice(0, 3),
    focusLine,
    microDrills,
    macroDrill: buildMacroDrill(input.practiceMode, focusLineText),
  };
}
