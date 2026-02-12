import { clsx } from "clsx";
import { Pause, Play, Square, SkipBack, SkipForward, RotateCcw, Mic } from "lucide-react";

type TransportControlsProps = {
  isPlaying: boolean;
  isRecording: boolean;
  onPlayReference: () => void;
  onRecord: () => void;
  onStop: () => void;
  onRetry: () => void;
  onNext: () => void;
  onPrev: () => void;
  canNext: boolean;
  canPrev: boolean;
};

export function TransportControls({
  isPlaying,
  isRecording,
  onPlayReference,
  onRecord,
  onStop,
  onRetry,
  onNext,
  onPrev,
  canNext,
  canPrev,
}: TransportControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev}
        className={clsx(
          "w-12 h-12 rounded-full flex items-center justify-center border border-white/10",
          canPrev ? "text-foreground hover:bg-white/10" : "text-muted-foreground/50"
        )}
      >
        <SkipBack className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={onPlayReference}
        className="px-5 py-3 rounded-full bg-white/10 text-sm font-semibold text-foreground flex items-center gap-2"
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        {isPlaying ? "Pause" : "Play Reference"}
      </button>

      <button
        type="button"
        onClick={isRecording ? onStop : onRecord}
        className={clsx(
          "px-5 py-3 rounded-full text-sm font-semibold flex items-center gap-2",
          isRecording
            ? "bg-destructive text-destructive-foreground"
            : "bg-primary text-primary-foreground"
        )}
      >
        {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        {isRecording ? "Stop" : "Record"}
      </button>

      <button
        type="button"
        onClick={onRetry}
        className="px-5 py-3 rounded-full bg-white/10 text-sm font-semibold text-foreground flex items-center gap-2"
      >
        <RotateCcw className="w-4 h-4" />
        Retry
      </button>

      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className={clsx(
          "w-12 h-12 rounded-full flex items-center justify-center border border-white/10",
          canNext ? "text-foreground hover:bg-white/10" : "text-muted-foreground/50"
        )}
      >
        <SkipForward className="w-5 h-5" />
      </button>
    </div>
  );
}
