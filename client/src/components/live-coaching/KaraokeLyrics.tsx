import { useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { TimedWord, WordFeedback } from "./types";

type KaraokeLine = {
  words: TimedWord[];
};

type KaraokeLyricsProps = {
  lines: KaraokeLine[];
  currentTime: number;
  size?: "compact" | "large";
  align?: "center" | "left";
  windowed?: boolean;
  wordFeedback?: Record<number, WordFeedback>;
  focusLineIndex?: number | null;
  liveCurrentWordIndex?: number | null;
  isRecording?: boolean;
  activeHighlight?: boolean;
};

const PAUSE_GAP_SEC = 0.6;

export function KaraokeLyrics({
  lines,
  currentTime,
  size = "large",
  align = "center",
  windowed = true,
  wordFeedback,
  focusLineIndex = null,
  liveCurrentWordIndex = null,
  isRecording = false,
  activeHighlight = true,
}: KaraokeLyricsProps) {
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (focusLineIndex === null || focusLineIndex === undefined) return;
    const node = lineRefs.current[focusLineIndex];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusLineIndex]);
  const getWordClass = (
    status: string | undefined,
    isActive: boolean,
    isLiveActive: boolean
  ) => {
    const statusClass =
      status === "correct"
        ? "text-emerald-400"
        : status === "correct_early" || status === "correct_late"
        ? "text-amber-400"
        : status === "incorrect"
        ? "text-red-400"
        : status === "missed"
        ? "text-muted-foreground/60"
        : "text-current";
    const highlight =
      isLiveActive || isActive
        ? "text-emerald-50 bg-emerald-500/25 ring-1 ring-emerald-400/40 rounded-md px-1"
        : statusClass;
    return clsx(
      "transition-colors duration-150 whitespace-normal break-words",
      statusClass,
      highlight
    );
  };
  let activeLineIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const hasActive = lines[i].words.some(
      (word) => currentTime >= word.start && currentTime <= word.end
    );
    if (hasActive) {
      activeLineIndex = i;
      break;
    }
  }

  const windowStart = Math.max(0, activeLineIndex - 1);
  const windowEnd = Math.min(lines.length, windowStart + 3);
  const visibleLines = windowed ? lines.slice(windowStart, windowEnd) : lines;

  const sizeClass = size === "compact" ? "text-lg md:text-xl" : "text-2xl md:text-3xl";
  const alignment = align === "left" ? "text-left" : "text-center";

  return (
    <div className={clsx("space-y-4 max-w-4xl mx-auto w-full", alignment)}>
      {visibleLines.map((line, lineOffset) => {
        const lineIndex = windowStart + lineOffset;
        const isFocusLine = focusLineIndex === lineIndex;
        return (
          <div
            key={`line-${lineIndex}`}
            ref={(node) => {
              lineRefs.current[lineIndex] = node;
            }}
            className={clsx(
              sizeClass,
              "font-display font-semibold tracking-tight leading-snug flex flex-wrap gap-x-2 gap-y-1 break-words",
              align === "center" ? "justify-center" : "justify-start",
              lineIndex === activeLineIndex ? "text-foreground" : "text-muted-foreground/60",
              isFocusLine && "ring-1 ring-emerald-400/30 rounded-lg"
            )}
          >
            {line.words.map((word, wordIndex) => {
              const isActive = activeHighlight && currentTime >= word.start && currentTime <= word.end;
              const isLiveActive =
                isRecording &&
                liveCurrentWordIndex !== null &&
                liveCurrentWordIndex !== undefined &&
                word.refIndex === liveCurrentWordIndex;
              const feedback = word.refIndex !== undefined ? wordFeedback?.[word.refIndex] : undefined;
              const status = feedback?.status;
              const tooltip = feedback
                ? `Ref ${feedback.refStart.toFixed(2)}s -> ${feedback.refEnd.toFixed(
                    2
                  )}s | You ${feedback.userStart?.toFixed(2) ?? "--"}s -> ${
                    feedback.userEnd?.toFixed(2) ?? "--"
                  }s | Delta ${feedback.deltaMs ?? "--"}ms${
                    feedback.userWord ? ` | said "${feedback.userWord}"` : ""
                  }${feedback.confidenceLabel ? ` | confidence ${feedback.confidenceLabel}` : ""}`
                : undefined;
              const nextWord = line.words[wordIndex + 1];
              const gap = nextWord ? nextWord.start - word.end : 0;
              const showGap = gap > PAUSE_GAP_SEC;

              return (
                <span key={`word-wrap-${lineIndex}-${wordIndex}`} className="inline-flex items-center gap-2">
                  <span
                    className={getWordClass(status, isActive, isLiveActive)}
                    style={
                      isLiveActive || isActive
                        ? { boxShadow: "0 0 10px rgba(34,197,94,0.35)" }
                        : undefined
                    }
                    title={tooltip}
                  >
                    {word.word}
                  </span>
                  {showGap && (
                    <span className="text-muted-foreground/40 select-none" aria-hidden>
                      ...
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
