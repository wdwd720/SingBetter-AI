import { Mic, Play, Square, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { clsx } from "clsx";
import type { LiveCoachMetrics } from "@/lib/liveCoach";
import type { CalibrationMetrics, PracticeMode } from "./types";

type RecordingPanelProps = {
  phase: string;
  countdown: number | null;
  recordingTime: number;
  inputLevel: number;
  liveCoach?: LiveCoachMetrics | null;
  liveUpdateHz?: number;
  showDebug?: boolean;
  calibrationStatus?: "idle" | "running" | "passed" | "failed";
  calibrationMetrics?: CalibrationMetrics | null;
  calibrationIssues?: string[];
  calibrationGuidance?: string[];
  calibrationOverride?: boolean;
  onCalibrate?: () => void;
  onOverrideCalibration?: () => void;
  onResetCalibration?: () => void;
  practiceMode?: PracticeMode;
  onPracticeModeChange?: (mode: PracticeMode) => void;
  canRecord?: boolean;
  onStartPractice: () => void;
  onStop: () => void;
  onRetry: () => void;
  onPlayReference: () => void;
  onEnableMic: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  micReady: boolean;
  disabled?: boolean;
};

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RecordingPanel({
  phase,
  countdown,
  recordingTime,
  inputLevel,
  liveCoach,
  liveUpdateHz = 0,
  showDebug = false,
  calibrationStatus = "idle",
  calibrationMetrics,
  calibrationIssues = [],
  calibrationGuidance = [],
  calibrationOverride = false,
  onCalibrate,
  onOverrideCalibration,
  onResetCalibration,
  practiceMode = "full",
  onPracticeModeChange,
  canRecord = true,
  onStartPractice,
  onStop,
  onRetry,
  onPlayReference,
  onEnableMic,
  onPrev,
  onNext,
  canPrev,
  canNext,
  micReady,
  disabled,
}: RecordingPanelProps) {
  const isRecording = phase === "recording";
  const isProcessing =
    phase === "stopping" || phase === "uploading_attempt" || phase === "analyzing_attempt";
  const isPriming = phase === "priming";
  const isPlaying = phase === "playing_ref";
  const showLive = phase === "recording" && liveCoach;
  const isCalibrating = phase === "calibrating";
  const isCalibrationFailed = calibrationStatus === "failed";
  const calibrationReady = calibrationStatus === "passed" || calibrationOverride;

  const pitchLabel = liveCoach?.pitchLabel ?? "unvoiced";
  const timingLabel = liveCoach?.timingLabel ?? "on";
  const energyLabel = liveCoach?.energyLabel ?? "good";
  const clarityLabel = liveCoach?.clarityLabel ?? "clear-ish";
  const stabilityLabel = liveCoach && liveCoach.stability >= 70 ? "steady" : "wobbly";

  const labelClass = (label: string) => {
    if (label === "on" || label === "steady" || label === "good" || label === "clear-ish") {
      return "text-emerald-400";
    }
    if (label === "flat" || label === "sharp" || label === "ahead" || label === "behind") {
      return "text-amber-400";
    }
    if (label === "quiet" || label === "loud" || label === "unvoiced" || label === "wobbly") {
      return "text-red-300";
    }
    return "text-muted-foreground";
  };

  const primaryLabel = isRecording ? "Stop" : "Record";
  const primaryIcon = isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />;
  const primaryClasses = isRecording
    ? "bg-red-500 text-white hover:bg-red-500/90"
    : "bg-primary text-primary-foreground hover:bg-primary/90";

  const statusLabel = () => {
    if (isRecording) return "Recording";
    if (isCalibrating) return "Calibrating";
    if (phase === "uploading_attempt") return "Uploading";
    if (phase === "analyzing_attempt") return "Analyzing";
    if (isProcessing) return "Processing";
    if (isPlaying) return "Playing Reference";
    return "Ready";
  };

  return (
    <div className="bg-card border border-white/5 rounded-3xl p-6 space-y-6 relative">
      {countdown !== null && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-background/70 backdrop-blur-sm">
          <div className="text-6xl md:text-8xl font-display font-bold text-emerald-300 drop-shadow-lg">
            {countdown}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Practice</div>
          <div className="text-lg font-semibold">
            {isPriming ? "Priming Mic" : statusLabel()}
          </div>
          <div className="text-xs text-muted-foreground">
            {micReady
              ? calibrationReady
                ? "Record starts after the reference plays."
                : "Run mic check before recording."
              : "Enable mic to start recording."}
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          {countdown !== null ? `Starts in ${countdown}` : formatTime(recordingTime)}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Mic Check</div>
          <div className="text-[10px] text-muted-foreground">
            {calibrationStatus === "running"
              ? "Sampling..."
              : calibrationStatus === "passed"
              ? "Passed"
              : calibrationStatus === "failed"
              ? "Needs attention"
              : "Not run"}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {calibrationStatus === "running"
            ? "Recording a 3-second sample."
            : calibrationStatus === "passed"
            ? "Mic levels look good."
            : "Check levels before recording."}
        </div>
        {calibrationMetrics && (
          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
            <div>avgRms: {calibrationMetrics.rmsAvg.toFixed(3)}</div>
            <div>peak: {calibrationMetrics.peak.toFixed(2)}</div>
            <div>snrDb: {calibrationMetrics.snrDb.toFixed(1)}</div>
            <div>clipPct: {(calibrationMetrics.clippingPct * 100).toFixed(1)}%</div>
          </div>
        )}
        {calibrationIssues.length > 0 && (
          <div className="text-xs text-amber-200">
            {calibrationIssues.join(" | ")}
          </div>
        )}
        {calibrationGuidance.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            {calibrationGuidance.join(" ")}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {onCalibrate && (
            <button
              type="button"
              disabled={disabled || !micReady || calibrationStatus === "running"}
              onClick={onCalibrate}
              className={clsx(
                "px-3 py-1 rounded-full text-xs font-semibold border border-white/10",
                disabled || !micReady || calibrationStatus === "running"
                  ? "opacity-60 cursor-not-allowed"
                  : "text-foreground hover:bg-white/10"
              )}
            >
              Run calibration
            </button>
          )}
          {isCalibrationFailed && !calibrationOverride && onOverrideCalibration && (
            <button
              type="button"
              onClick={onOverrideCalibration}
              className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10"
            >
              Record anyway
            </button>
          )}
          {calibrationMetrics && onResetCalibration && (
            <button
              type="button"
              onClick={onResetCalibration}
              className="px-3 py-1 rounded-full text-xs font-semibold border border-white/10 text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Input Level</div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-primary to-secondary transition-all"
            style={{ width: `${Math.min(100, Math.max(4, inputLevel * 100))}%` }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Practice Mode</div>
        <div className="flex flex-wrap gap-2">
          {(["full", "words", "timing", "pitch"] as PracticeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onPracticeModeChange?.(mode)}
              className={clsx(
                "px-3 py-1 rounded-full text-xs font-semibold border border-white/10 transition-colors",
                practiceMode === mode
                  ? "bg-white/10 text-foreground border-white/20"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode === "full"
                ? "Full"
                : mode === "words"
                ? "Words only"
                : mode === "timing"
                ? "Timing only"
                : "Pitch only"}
            </button>
          ))}
        </div>
      </div>

      {showLive && liveCoach && (
        <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Live Coach</div>
            <div className="text-[10px] text-muted-foreground">~{Math.round(liveUpdateHz)}hz</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
              Pitch: <span className={labelClass(pitchLabel)}>{pitchLabel}</span>
              {typeof liveCoach.centsError === "number" && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {Math.round(liveCoach.centsError)}c
                </span>
              )}
            </div>
            <div>
              Timing: <span className={labelClass(timingLabel)}>{timingLabel}</span>
            </div>
            <div>
              Energy: <span className={labelClass(energyLabel)}>{energyLabel}</span>
            </div>
            <div>
              Clarity: <span className={labelClass(clarityLabel)}>{clarityLabel}</span>
            </div>
            <div>
              Stability: <span className={labelClass(stabilityLabel)}>{stabilityLabel}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Pace: {liveCoach.paceRatio.toFixed(2)}x
            </div>
          </div>
          {liveCoach.liveTip && (
            <div className="text-xs text-foreground/80">{liveCoach.liveTip}</div>
          )}
          {showDebug && (
            <div className="text-[10px] text-muted-foreground">
              rms {liveCoach.rms.toFixed(3)} | f0{" "}
              {liveCoach.f0Hz ? liveCoach.f0Hz.toFixed(1) : "--"}hz | voiced{" "}
              {liveCoach.voiced ? "yes" : "no"}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || !micReady || isProcessing || isPriming || !canRecord || isCalibrating}
          onClick={isRecording ? onStop : onStartPractice}
          className={clsx(
            "flex items-center gap-2 px-5 py-3 rounded-full font-semibold text-sm transition-colors",
            primaryClasses,
            (disabled || !micReady || isProcessing || isPriming || !canRecord || isCalibrating) &&
              "opacity-60 cursor-not-allowed"
          )}
        >
          {primaryIcon}
          {primaryLabel}
        </button>

        {!micReady && (
          <button
            type="button"
            disabled={disabled || isProcessing || isPriming}
            onClick={onEnableMic}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-white/10 transition-colors text-muted-foreground hover:text-foreground",
              (disabled || isProcessing || isPriming) && "opacity-60 cursor-not-allowed"
            )}
          >
            Enable Mic
          </button>
        )}

        <button
          type="button"
          disabled={disabled || isRecording || isProcessing}
          onClick={onPlayReference}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-white/10 transition-colors",
            isPlaying ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            (disabled || isRecording || isProcessing) && "opacity-60 cursor-not-allowed"
          )}
        >
          <Play className="w-4 h-4" />
          Play Reference
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onRetry}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-white/10 transition-colors text-muted-foreground hover:text-foreground",
            disabled && "opacity-60 cursor-not-allowed"
          )}
        >
          <RotateCcw className="w-4 h-4" />
          Re-record
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev || isRecording || isProcessing}
            className={clsx(
              "h-10 w-10 rounded-full border border-white/10 flex items-center justify-center transition-colors",
              canPrev ? "text-foreground hover:bg-white/10" : "text-muted-foreground opacity-50"
            )}
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext || isRecording || isProcessing}
            className={clsx(
              "h-10 w-10 rounded-full border border-white/10 flex items-center justify-center transition-colors",
              canNext ? "text-foreground hover:bg-white/10" : "text-muted-foreground opacity-50"
            )}
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
