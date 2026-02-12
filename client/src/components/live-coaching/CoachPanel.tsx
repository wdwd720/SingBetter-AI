import { clsx } from "clsx";
import type { CoachingHistoryPoint, LiveMeters, LiveScores } from "./types";
import type { DrillPlan } from "@/lib/coachDrills";
import type { CoachPriorityResult } from "@/lib/coachPriority";
import type { CoachCard } from "@/lib/coachCards";
import type { DrillSession } from "@/lib/drillSession";
import { formatPassCondition } from "@/lib/drillSession";
import type { CoachReport } from "@/lib/coachReport";

const chipClass =
  "text-xs uppercase tracking-widest text-foreground/90 bg-white/5 border border-white/10 rounded-full px-3 py-1";

type ScoreBreakdown = {
  pitch: number;
  timing: number;
  lyrics: number;
  stability: number;
};

type CoachPanelProps = {
  phase: string;
  meters: LiveMeters;
  scores: LiveScores | null;
  scoreBreakdown?: ScoreBreakdown | null;
  coachPriority?: CoachPriorityResult | null;
  coachReport?: CoachReport | null;
  drillPlan?: DrillPlan | null;
  coachCards?: CoachCard[];
  coachMode?: boolean;
  drillSession?: DrillSession | null;
  drillDelta?: string | null;
  drillTargetLine?: string | null;
  drillTargetLineIndex?: number | null;
  onRetryDrill?: () => void;
  onSkipDrill?: () => void;
  onNextLine?: () => void;
  onPlayReference?: () => void;
  history?: CoachingHistoryPoint[];
};

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
        <span>{label}</span>
        <span className="text-foreground font-semibold">{Math.round(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function ProgressSparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const width = 160;
  const height = 40;
  const padding = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x =
      padding + (values.length === 1 ? 0 : (index / (values.length - 1)) * (width - padding * 2));
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return { x, y };
  });

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-10">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-primary"
      />
    </svg>
  );
}

export function CoachPanel({
  phase,
  meters,
  scores,
  scoreBreakdown,
  coachPriority,
  coachReport,
  drillPlan,
  coachCards,
  coachMode,
  drillSession,
  drillDelta,
  drillTargetLine,
  drillTargetLineIndex,
  onRetryDrill,
  onSkipDrill,
  onNextLine,
  onPlayReference,
  history,
}: CoachPanelProps) {
  const showResults = phase === "showing_feedback" && scores;
  const showLiveMeters = phase === "recording" || phase === "playing_ref" || showResults;
  const showDrillSession = Boolean(showResults && coachMode && drillSession);

  const historyPoints = (history ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const historyScores = historyPoints.map((attempt) => attempt.scores.overall);
  const bestScore = historyScores.length ? Math.max(...historyScores) : 0;
  const avgScore = historyScores.length
    ? Math.round(historyScores.reduce((acc, val) => acc + val, 0) / historyScores.length)
    : 0;
  const improvementPct =
    historyScores.length > 1
      ? Math.round(
          ((historyScores[historyScores.length - 1] - historyScores[0]) /
            Math.max(1, historyScores[0])) *
            100
        )
      : 0;

  return (
    <div className="bg-card border border-white/5 rounded-3xl p-6 space-y-6">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Coach</div>
        <h2 className="text-xl font-display font-bold">Coach Results</h2>
      </div>

      {showLiveMeters ? (
        <div className="space-y-4">
          <Meter label={scores?.label || "Pitch Accuracy"} value={meters.pitch} />
          <Meter label="Timing" value={meters.timing} />
          <Meter label="Stability" value={meters.stability} />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
          Record a take to see results. Live meters appear while recording.
        </div>
      )}

      {showResults && scores && (
        <div className="space-y-4 pt-4 border-t border-white/5">
          {coachReport && (
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Coach Report</div>
              {coachReport.topIssues.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {coachReport.topIssues.map((issue) => (
                    <span key={`report-issue-${issue}`} className={clsx(chipClass)}>
                      {issue}
                    </span>
                  ))}
                </div>
              )}
              {coachReport.focusLine && (
                <div className="text-xs text-muted-foreground">
                  {coachReport.focusLine.index >= 0
                    ? `Focus line ${coachReport.focusLine.index + 1}: "${coachReport.focusLine.text}"`
                    : `Focus phrase: "${coachReport.focusLine.text}"`}
                </div>
              )}
              {coachReport.microDrills.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Micro Drills</div>
                  {coachReport.microDrills.map((drill) => (
                    <div key={drill} className="text-xs text-muted-foreground">
                      {drill}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Macro drill: {coachReport.macroDrill}
              </div>
            </div>
          )}

          {coachPriority?.summary && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Summary</div>
              <div className="text-sm text-foreground/90 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                {coachPriority.summary}
              </div>
            </div>
          )}

          {coachPriority?.focusLine && (
            <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2 space-y-1">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Focus Line</div>
              <div className="text-sm font-semibold">
                {coachPriority.focusLine.index >= 0
                  ? `Line ${coachPriority.focusLine.index + 1}: ${coachPriority.focusLine.text}`
                  : `Focus phrase: ${coachPriority.focusLine.text}`}
              </div>
              <div className="text-xs text-muted-foreground">Source: {coachPriority.focusLine.source}</div>
            </div>
          )}

          {scoreBreakdown && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Overall Score</div>
                  <div className="text-3xl font-display font-bold">{scores.overall}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  Pitch {scores.pitch} - Timing {scores.timing} - Stability {scores.stability}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Pitch</div>
                  <div className="text-xl font-bold">{Math.round(scoreBreakdown.pitch)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Timing</div>
                  <div className="text-xl font-bold">{Math.round(scoreBreakdown.timing)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Lyrics</div>
                  <div className="text-xl font-bold">{Math.round(scoreBreakdown.lyrics)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Stability</div>
                  <div className="text-xl font-bold">{Math.round(scoreBreakdown.stability)}</div>
                </div>
              </div>
            </div>
          )}

          {coachPriority?.topIssues?.length ? (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Top Issues</div>
              <div className="flex flex-wrap gap-2">
                {[...new Set(coachPriority.topIssues)].map((issue) => (
                  <span key={issue} className={clsx(chipClass)}>
                    {issue}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {coachCards && coachCards.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Focus Areas</div>
              <div className="grid gap-3">
                {coachCards.slice(0, 2).map((card) => (
                  <div
                    key={card.key}
                    className="rounded-2xl border border-white/10 bg-background/70 px-3 py-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{card.title}</div>
                      {typeof card.score === "number" && (
                        <div className="text-sm text-muted-foreground">{Math.round(card.score)}</div>
                      )}
                    </div>
                    {card.items && card.items.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {card.items.slice(0, 4).map((item) => (
                          <span
                            key={`${card.key}-${item}`}
                            className="text-xs rounded-full border border-white/10 px-2 py-0.5 text-muted-foreground"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                    {card.tips && card.tips.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {card.tips.slice(0, 2).join(" ")}
                      </div>
                    )}
                    {card.drill && (
                      <div className="text-xs text-muted-foreground">
                        Drill: {card.drill.title}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showDrillSession && drillSession && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Drill Session</div>
              <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Drill: {drillSession.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Rep {Math.max(1, drillSession.currentRep)} of {drillSession.repeatCount}
                  </div>
                </div>
                {drillTargetLine && (
                  <div className="text-xs text-muted-foreground">
                    Target line{" "}
                    {typeof drillTargetLineIndex === "number" ? drillTargetLineIndex + 1 : ""}: "{drillTargetLine}"
                  </div>
                )}
                <div className="text-xs text-muted-foreground">Goal: {formatPassCondition(drillSession)}</div>
                {drillDelta && (
                  <div className="text-xs text-muted-foreground">Delta: {drillDelta}</div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {onRetryDrill && (
                    <button
                      type="button"
                      onClick={onRetryDrill}
                      className="px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold"
                    >
                      Retry Target Line
                    </button>
                  )}
                  {onSkipDrill && (
                    <button
                      type="button"
                      onClick={onSkipDrill}
                      className="px-3 py-1 rounded-full bg-white/10 text-xs font-semibold"
                    >
                      Skip Drill
                    </button>
                  )}
                  {drillSession.status === "passed" && onNextLine && (
                    <button
                      type="button"
                      onClick={onNextLine}
                      className="px-3 py-1 rounded-full bg-white/10 text-xs font-semibold"
                    >
                      Next Line
                    </button>
                  )}
                  {onPlayReference && (
                    <button
                      type="button"
                      onClick={onPlayReference}
                      className="px-3 py-1 rounded-full bg-white/10 text-xs font-semibold"
                    >
                      Listen Reference
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {drillSession.status === "passed"
                    ? "Cleared - move on or keep refining."
                    : drillSession.status === "failed"
                    ? "Keep working - redo the drill or switch focus."
                    : "In progress - repeat the target line."}
                </div>
              </div>
            </div>
          )}

          {drillPlan && !coachMode && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Drill</div>
              <div className="text-sm text-foreground/90 bg-white/5 border border-white/10 rounded-xl px-3 py-2 space-y-1">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Focus: {drillPlan.focus} - Repeat {drillPlan.repeatCount}x
                </div>
                {typeof drillPlan.targetLineIndex === "number" && (
                  <div className="text-xs text-muted-foreground">Target line {drillPlan.targetLineIndex + 1}</div>
                )}
                {drillPlan.steps.map((step, index) => (
                  <div key={`drill-step-${index}`} className="text-xs text-muted-foreground">
                    {index + 1}. {step}
                  </div>
                ))}
              </div>
            </div>
          )}

          {historyScores.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Progress</div>
              <ProgressSparkline values={historyScores} />
              <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                <div>Best {bestScore}</div>
                <div>Avg {avgScore}</div>
                <div>Improve {improvementPct >= 0 ? "+" : "-"}{Math.abs(improvementPct)}%</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
