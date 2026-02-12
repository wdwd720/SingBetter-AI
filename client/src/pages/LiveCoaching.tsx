import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomNav } from "@/components/BottomNav";
import { KaraokeLyrics } from "@/components/live-coaching/KaraokeLyrics";
import { VerseSelector } from "@/components/live-coaching/VerseSelector";
import { CoachPanel } from "@/components/live-coaching/CoachPanel";
import { RecordingPanel } from "@/components/live-coaching/RecordingPanel";
import type {
  CalibrationMetrics,
  CoachingHistoryPoint,
  DetailedFeedback,
  LiveMeters,
  LiveScores,
  PracticeMode,
  TimedWord,
  Verse,
  WordFeedback,
} from "@/components/live-coaching/types";
import { useToast } from "@/hooks/use-toast";
import { useAudioLevel } from "@/hooks/use-audio-analysis";
import { recordCalibrationSample, startRecorder } from "@/lib/recorder";
import { analyzeSilence, evaluateCalibration, summarizeCalibration } from "@/lib/audioMetrics";
import { estimateAlignmentOffsetMs } from "@/lib/offset";
import { buildCoachFeedback, type CoachCoreResult } from "@/lib/coachCore";
import { buildWordCoach } from "@/lib/coachWords";
import { buildDrillPlan } from "@/lib/coachDrills";
import { buildCoachPriority, type FocusLine } from "@/lib/coachPriority";
import { buildCoachCards } from "@/lib/coachCards";
import { buildCoachReport } from "@/lib/coachReport";
import { buildDictionCoach, type DictionCoach } from "@/lib/diction";
import { buildNoteCoach, extractNoteEvents, type NoteCoach, type NoteEvent } from "@/lib/notePitch";
import { buildBreathCoach, type BreathCoach } from "@/lib/breathCoach";
import {
  appendDrillRep,
  buildRepDelta,
  createDrillSession,
  extractUnifiedMetrics,
  selectDrillFocus,
  type DrillSession,
} from "@/lib/drillSession";
import { startLiveCoach, type LiveCoachMetrics } from "@/lib/liveCoach";
import { buildPitchCoach, type PitchCoach } from "@/lib/coachPitch";
import { comparePitchContours } from "@/lib/pitchCompare";
import {
  computePitchMetrics,
  extractPitchContourFromBlob,
  extractPitchContourFromBuffer,
  type PitchContour,
  type PitchMetrics,
} from "@/lib/pitchMetrics";
import {
  averageAbsoluteCentsDiff,
  centsOff,
  detectPitch,
  extractPitchContour,
  pitchStabilityScore,
} from "@/lib/pitch";
import { Loader2, UploadCloud } from "lucide-react";

type TranscriptionSegment = {
  start: number;
  end: number;
  text: string;
  words?: Array<{ start: number; end: number; word: string }>;
};

type ReferenceWordPayload = {
  word: string;
  start: number;
  end: number;
  lineIndex: number;
  wordIndex: number;
  refIndex: number;
};

type ReferenceLinePayload = {
  index: number;
  text: string;
  start: number;
  end: number;
};

type UploadResponse = {
  id: number;
  publicUrl: string;
  filename: string;
  mimeType: string;
};

type RecordingUploadResponse = {
  id: number;
  recordingUrl: string;
  publicUrl: string;
  durationSec: number;
};

type AnalysisResponse = LiveScores & {
  alignment?: {
    timingCorrelation: number;
    estimatedOffsetMs?: number;
  };
  detailed?: DetailedFeedback;
  warnings?: string[];
};

type PreparedAttempt = {
  blob: Blob;
  durationSec: number;
  userBuffer: AudioBuffer;
  refContour: ReturnType<typeof extractPitchContour>;
  userContour: ReturnType<typeof extractPitchContour>;
  referenceEnvelope: number[];
  userEnvelope: number[];
  estimatedOffsetMs: number;
  pitchMetrics?: PitchMetrics;
};

const SCORE_THRESHOLD = 80;
const MIN_WORDS_PER_VERSE = 6;
const MIN_FRAGMENT_WORDS = 4;
const PAUSE_SPLIT_SEC = 0.9;
const SILENCE_RMS_THRESHOLD = 0.012;
const SILENCE_WARN_SEC = 1.5;

function getTranscribeHint(code?: string): string {
  if (!code) return "Try a shorter segment or paste lyrics manually.";
  switch (code) {
    case "OUT_OF_MEMORY":
      return "Model ran out of memory; try Quick mode or a shorter segment.";
    case "NO_SPEECH":
      return "No speech detected; try a louder section or paste lyrics manually.";
    case "FFMPEG_NOT_FOUND":
      return "Install ffmpeg to improve MP3/M4A support.";
    default:
      return "Paste lyrics manually to continue.";
  }
}

function splitWords(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function buildLinesForVerse(verseText: string, wordsInVerse: string[]): string[] {
  const manualLines = verseText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (manualLines.length > 1) return manualLines;
  if (wordsInVerse.length === 0) return manualLines;

  const maxWordsPerLine = 8;
  const maxCharsPerLine = 46;
  const lines: string[] = [];
  let current: string[] = [];
  let currentChars = 0;

  wordsInVerse.forEach((word) => {
    const nextChars = currentChars + (currentChars ? 1 : 0) + word.length;
    const nextCount = current.length + 1;
    if (current.length > 0 && (nextCount > maxWordsPerLine || nextChars > maxCharsPerLine)) {
      lines.push(current.join(" "));
      current = [word];
      currentChars = word.length;
      return;
    }
    current.push(word);
    currentChars = nextChars;
  });

  if (current.length) lines.push(current.join(" "));
  return lines.length ? lines : manualLines;
}

function autoSplitVerses(
  rawVerses: string[],
  segments: TranscriptionSegment[],
  targetWordsPerVerse: number,
  hasExplicitBreaks: boolean
): string[] {
  if (hasExplicitBreaks) return rawVerses;
  if (rawVerses.length !== 1) return rawVerses;
  const base = rawVerses[0] || "";
  const baseWords = splitWords(base);
  if (baseWords.length <= targetWordsPerVerse) return rawVerses;

  if (segments.length > 0) {
    const verses: string[] = [];
    let bucket: string[] = [];
    let count = 0;
    segments.forEach((segment, index) => {
      const segmentText = segment.text.trim();
      if (!segmentText) return;
      const segWords = splitWords(segmentText);
      const nextSegment = segments[index + 1];
      const gapToNext =
        nextSegment && Number.isFinite(nextSegment.start)
          ? Math.max(0, nextSegment.start - segment.end)
          : 0;
      const endsSentence = /[.!?]$/.test(segmentText);
      const shouldSplit =
        count + segWords.length >= targetWordsPerVerse &&
        (endsSentence || gapToNext >= PAUSE_SPLIT_SEC);
      if (shouldSplit && count > 0) {
        verses.push(bucket.join(" ").trim());
        bucket = [];
        count = 0;
      }
      bucket.push(segmentText);
      count += segWords.length;
    });
    if (bucket.length) verses.push(bucket.join(" ").trim());
    return verses.length ? verses : rawVerses;
  }

  const verses: string[] = [];
  for (let i = 0; i < baseWords.length; i += targetWordsPerVerse) {
    verses.push(baseWords.slice(i, i + targetWordsPerVerse).join(" "));
  }
  return verses.length ? verses : rawVerses;
}

function mergeShortVerses(verses: string[], minWords: number): string[] {
  if (verses.length < 2) return verses;
  const merged: string[] = [];
  let i = 0;
  while (i < verses.length) {
    const current = verses[i];
    const words = splitWords(current);
    const endsWithPunctuation = /[.!?]$/.test(current.trim());
    const shouldMerge = words.length < minWords || (words.length <= MIN_FRAGMENT_WORDS && !endsWithPunctuation);
    if (shouldMerge && i + 1 < verses.length) {
      const next = verses[i + 1];
      merged.push(`${current} ${next}`.trim());
      i += 2;
      continue;
    }
    merged.push(current);
    i += 1;
  }
  return merged;
}

function buildTimedWordsFromSegments(segments: TranscriptionSegment[]): Array<{
  word: string;
  start: number;
  end: number;
}> {
  const words: Array<{ word: string; start: number; end: number }> = [];
  segments.forEach((segment) => {
    if (segment.words && segment.words.length > 0) {
      segment.words.forEach((w) => {
        words.push({ word: w.word, start: w.start, end: w.end });
      });
      return;
    }
    const segmentWords = splitWords(segment.text);
    const duration = segment.end - segment.start;
    if (segmentWords.length === 0 || duration <= 0) return;
    segmentWords.forEach((word, index) => {
      const start = segment.start + (duration * index) / segmentWords.length;
      const end = segment.start + (duration * (index + 1)) / segmentWords.length;
      words.push({ word, start, end });
    });
  });
  return words;
}

function buildVerses(
  lyricsText: string,
  segments: TranscriptionSegment[],
  totalDuration: number
): Verse[] {
  const hasExplicitBreaks = /\n\s*\n/.test(lyricsText);
  const rawVersesFromText = lyricsText
    .split(/\n\s*\n/)
    .map((verse) => verse.trim())
    .filter(Boolean);
  const rawVerses = autoSplitVerses(rawVersesFromText, segments, 44, hasExplicitBreaks);
  const processedVerses = hasExplicitBreaks
    ? rawVerses
    : mergeShortVerses(rawVerses, MIN_WORDS_PER_VERSE);

  const timedWords = buildTimedWordsFromSegments(segments);
  const totalWords = processedVerses.reduce(
    (sum, verse) => sum + splitWords(verse).length,
    0
  );

  let cursor = 0;
  let estimatedStart = 0;
  const verses: Verse[] = processedVerses.map((verseText, index) => {
    const wordsInVerse = splitWords(verseText);
    const lines = buildLinesForVerse(verseText, wordsInVerse);
    const verseWordCount = wordsInVerse.length || 1;

    const availableTimed = timedWords.slice(cursor, cursor + verseWordCount);
    const fallbackDuration =
      totalDuration > 0 ? (totalDuration * verseWordCount) / Math.max(1, totalWords) : verseWordCount * 0.6;
    const verseStart = availableTimed[0]?.start ?? estimatedStart;
    const verseEnd = availableTimed[availableTimed.length - 1]?.end ?? verseStart + fallbackDuration;

    const lineWordCounts = lines.map((line) => splitWords(line).length);
    const words: TimedWord[] = [];
    let lineIndex = 0;
    let wordIndex = 0;

    wordsInVerse.forEach((word, wordGlobalIndex) => {
      const timed = availableTimed[wordGlobalIndex];
      const start = timed?.start ?? verseStart + (fallbackDuration * wordGlobalIndex) / verseWordCount;
      const end = timed?.end ?? verseStart + (fallbackDuration * (wordGlobalIndex + 1)) / verseWordCount;
      words.push({ word, start, end, lineIndex, wordIndex });

      wordIndex += 1;
      if (wordIndex >= (lineWordCounts[lineIndex] || Infinity)) {
        lineIndex += 1;
        wordIndex = 0;
      }
    });

    cursor += verseWordCount;
    estimatedStart = verseEnd;

    return {
      index,
      text: verseText,
      lines,
      startTime: verseStart,
      endTime: verseEnd,
      words,
    };
  });

  return verses;
}

export default function LiveCoaching() {
  const { toast } = useToast();
  const isDev = Boolean(import.meta.env.DEV);
  const [phase, setPhase] = useState<
    | "idle"
    | "uploaded"
    | "analyzing"
    | "ready"
    | "calibrating"
    | "calibration_failed"
    | "priming"
    | "playing_ref"
    | "countdown"
    | "recording"
    | "stopping"
    | "uploading_attempt"
    | "analyzing_attempt"
    | "showing_feedback"
  >("idle");
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [lyricsText, setLyricsText] = useState("");
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [manualLyrics, setManualLyrics] = useState("");
  const [verses, setVerses] = useState<Verse[]>([]);
  const [selectedVerse, setSelectedVerse] = useState(0);
  const [verseCount, setVerseCount] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [meters, setMeters] = useState<LiveMeters>({ pitch: 0, timing: 0, stability: 0 });
  const [scores, setScores] = useState<LiveScores | null>(null);
  const [previousDetailed, setPreviousDetailed] = useState<DetailedFeedback | null>(null);
  const [coachCore, setCoachCore] = useState<CoachCoreResult | null>(null);
  const [pitchCoach, setPitchCoach] = useState<PitchCoach | null>(null);
  const [noteCoach, setNoteCoach] = useState<NoteCoach | null>(null);
  const [dictionCoach, setDictionCoach] = useState<DictionCoach | null>(null);
  const [breathCoach, setBreathCoach] = useState<BreathCoach | null>(null);
  const [pitchAnalyzing, setPitchAnalyzing] = useState(false);
  const [history, setHistory] = useState<CoachingHistoryPoint[]>([]);
  const [coachMode, setCoachMode] = useState(true);
  const [coachLoop, setCoachLoop] = useState(false);
  const [drillSession, setDrillSession] = useState<DrillSession | null>(null);
  const [analysisSeq, setAnalysisSeq] = useState(0);
  const [liveCoachMetrics, setLiveCoachMetrics] = useState<LiveCoachMetrics | null>(null);
  const [liveUpdateHz, setLiveUpdateHz] = useState(0);
  const [liveEvents, setLiveEvents] = useState<string[]>([]);
  const [recordingStats, setRecordingStats] = useState<{
    durationSec: number;
    blobSize: number;
    avgRms: number;
    voicedPct?: number;
    silentPct?: number;
    snrDb?: number;
    peak?: number;
    offsetMs?: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [autoLoopNote, setAutoLoopNote] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugOpen, setDebugOpen] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [lyricsSize, setLyricsSize] = useState<"compact" | "large">("large");
  const [recordingTime, setRecordingTime] = useState(0);
  const [quickMode, setQuickMode] = useState(true);
  const [micReady, setMicReady] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [calibrationMetrics, setCalibrationMetrics] = useState<CalibrationMetrics | null>(null);
  const [calibrationStatus, setCalibrationStatus] = useState<
    "idle" | "running" | "passed" | "failed"
  >("idle");
  const [calibrationIssues, setCalibrationIssues] = useState<string[]>([]);
  const [calibrationGuidance, setCalibrationGuidance] = useState<string[]>([]);
  const [calibrationOverride, setCalibrationOverride] = useState(false);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("full");
  const [analysisBlocked, setAnalysisBlocked] = useState<string | null>(null);
  const [estimatedOffsetMs, setEstimatedOffsetMs] = useState<number | null>(null);
  const [transcribeDisabled, setTranscribeDisabled] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const recordingStopRef = useRef<(() => Promise<{ blob: Blob; durationSec: number }>) | null>(null);
  const referenceBufferRef = useRef<AudioBuffer | null>(null);
  const referenceContourRef = useRef<ReturnType<typeof extractPitchContour> | null>(null);
  const recentPitchRef = useRef<number[]>([]);
  const phaseRef = useRef(phase);
  const playModeRef = useRef<"reference" | "practice">("reference");
  const micStreamRef = useRef<MediaStream | null>(null);
  const micInitRef = useRef<Promise<MediaStream> | null>(null);
  const referencePitchCacheRef = useRef<Map<string, PitchContour>>(new Map());
  const referenceNoteCacheRef = useRef<Map<string, NoteEvent[]>>(new Map());
  const silenceDurationRef = useRef(0);
  const silenceWarnedRef = useRef(false);
  const analysisSeqRef = useRef(0);
  const lastDrillSeqRef = useRef(0);
  const liveCoachRef = useRef<ReturnType<typeof startLiveCoach> | null>(null);
  const lastLiveUpdateRef = useRef<number | null>(null);
  const lastLiveLabelsRef = useRef<{
    pitchLabel?: string;
    timingLabel?: string;
    energyLabel?: string;
  }>({});
  const playbackSessionRef = useRef<number | null>(null);
  const sessionIdRef = useRef(0);
  const recordingSessionRef = useRef<number | null>(null);
  const rmsSumRef = useRef(0);
  const rmsCountRef = useRef(0);
  const lastLiveTimeRef = useRef<number | null>(null);
  const coachLoopRef = useRef(coachLoop);
  const autoLoopTimeoutRef = useRef<number | null>(null);
  const pendingAttemptRef = useRef<PreparedAttempt | null>(null);
  const calibrationSessionRef = useRef<number | null>(null);
  const celebrationShownRef = useRef(false);

  const { level: baseInputLevel } = useAudioLevel(micStream, micReady && phase !== "recording");
  const inputLevel =
    phase === "recording" && liveCoachMetrics ? liveCoachMetrics.rms : baseInputLevel;

  useEffect(() => {
    coachLoopRef.current = coachLoop;
  }, [coachLoop]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const unlockAudioContext = useCallback(async () => {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    if (context.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
    await context.close().catch(() => undefined);
  }, []);

  const initMic = useCallback(async () => {
    if (micStreamRef.current && micStreamRef.current.active) {
      setMicReady(true);
      setMicStream(micStreamRef.current);
      return micStreamRef.current;
    }
    if (micInitRef.current) return micInitRef.current;
    micInitRef.current = (async () => {
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      } as const;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      micStreamRef.current = stream;
      setMicStream(stream);
      setMicReady(true);
      await unlockAudioContext();
      return stream;
    })();
    try {
      return await micInitRef.current;
    } finally {
      micInitRef.current = null;
    }
  }, [unlockAudioContext]);

  const fetchHistory = useCallback(async (uploadId?: number) => {
    try {
      const params = new URLSearchParams();
      if (uploadId) {
        params.set("uploadId", String(uploadId));
      }
      const response = await fetch(
        `/api/live-coaching/history${params.toString() ? `?${params.toString()}` : ""}`,
        { credentials: "include" }
      );
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data)) {
        setHistory(data);
      }
    } catch (err) {
      console.warn("Failed to load history", err);
    }
  }, []);

  const hasAudio = Boolean(audioUrl);
  const hasVerses = verses.length > 0;
  const canPrev = hasVerses && selectedVerse > 0;
  const canNext = hasVerses && selectedVerse + verseCount < verses.length;
  const canRecord = calibrationStatus === "passed" || calibrationOverride;
  const calibrationReady = canRecord;
  const calibrationSummary = useMemo(
    () => summarizeCalibration(calibrationMetrics),
    [calibrationMetrics]
  );

  const activeVerses = useMemo(() => {
    const end = Math.min(verses.length, selectedVerse + verseCount);
    return verses.slice(selectedVerse, end);
  }, [verses, selectedVerse, verseCount]);

  const referencePayload = useMemo(() => {
    const words: ReferenceWordPayload[] = [];
    const lines: ReferenceLinePayload[] = [];
    let lineOffset = 0;
    let refIndex = 0;

    activeVerses.forEach((verse) => {
      verse.lines.forEach((lineText, lineIndex) => {
        const lineWords = verse.words.filter((word) => word.lineIndex === lineIndex);
        const start = lineWords[0]?.start ?? verse.startTime;
        const end = lineWords[lineWords.length - 1]?.end ?? verse.endTime;
        const globalLineIndex = lineOffset + lineIndex;
        lines.push({ index: globalLineIndex, text: lineText, start, end });
        lineWords.forEach((word) => {
          words.push({
            word: word.word,
            start: word.start,
            end: word.end,
            lineIndex: globalLineIndex,
            wordIndex: word.wordIndex,
            refIndex,
          });
          refIndex += 1;
        });
      });
      lineOffset += verse.lines.length;
    });

    return { words, lines };
  }, [activeVerses]);

  const analysisReferencePayload = useMemo(() => {
    const verseStart = activeVerses[0]?.startTime ?? 0;
    return {
      verseStart,
      words: referencePayload.words.map((word) => ({
        ...word,
        start: Math.max(0, word.start - verseStart),
        end: Math.max(0, word.end - verseStart),
      })),
      lines: referencePayload.lines.map((line) => ({
        ...line,
        start: Math.max(0, line.start - verseStart),
        end: Math.max(0, line.end - verseStart),
      })),
    };
  }, [referencePayload, activeVerses]);

  const wordFeedbackMap = useMemo(() => {
    if (!scores?.detailed?.perWord) return {};
    return scores.detailed.perWord.reduce<Record<number, WordFeedback>>((acc, word) => {
      acc[word.refIndex] = word;
      return acc;
    }, {});
  }, [scores?.detailed]);

  const activeSegment = useMemo(() => {
    if (activeVerses.length === 0) {
      return {
        start: 0,
        end: audioDuration > 0 ? audioDuration : 0,
        lines: [] as { words: TimedWord[] }[],
      };
    }
    const start = activeVerses[0].startTime;
    const end = activeVerses[activeVerses.length - 1].endTime;

    const lines: { words: TimedWord[] }[] = referencePayload.lines
      .sort((a, b) => a.index - b.index)
      .map((line) => {
        const lineWords = referencePayload.words
          .filter((word) => word.lineIndex === line.index)
          .map((word) => ({
            word: word.word,
            start: word.start,
            end: word.end,
            lineIndex: line.index,
            wordIndex: word.wordIndex,
            refIndex: word.refIndex,
          }));
        return { words: lineWords };
      })
      .filter((line) => line.words.length > 0);

    return { start, end, lines };
  }, [activeVerses, audioDuration, referencePayload]);

  const segmentDuration = Math.max(
    0,
    (activeSegment.end || audioDuration) - activeSegment.start
  );

  const detailed = scores?.detailed ?? null;
  const wordCoach = useMemo(() => {
    if (!detailed) return null;
    return buildWordCoach({
      perWord: detailed.perWord ?? [],
      segments: detailed.segments ?? [],
      missedWords: detailed.missedWords ?? [],
      extraWords: detailed.extraWords ?? [],
    });
  }, [detailed]);
  const focusLine = useMemo<FocusLine | null>(() => {
    if (noteCoach?.worstNotes?.[0]) {
      const note = noteCoach.worstNotes[0];
      const line = analysisReferencePayload.lines.find(
        (item) => note.start >= item.start && note.start <= item.end
      );
      if (line) {
        return { index: line.index, text: line.text, source: "notes" };
      }
    }
    if (dictionCoach?.worstWords?.[0]?.word) {
      const worst = dictionCoach.worstWords[0];
      const line = analysisReferencePayload.lines.find(
        (item) => worst.start >= item.start && worst.start <= item.end
      );
      if (line) {
        return { index: line.index, text: line.text, source: "diction" };
      }
    }
    if (pitchCoach && !pitchCoach.lowConfidence && pitchCoach.worstLines[0]?.text) {
      const line = pitchCoach.worstLines[0];
      return { index: line.lineIndex, text: line.text ?? "", source: "pitch" };
    }
    if (detailed?.segments?.length) {
      const worstSegment = [...detailed.segments].sort(
        (a, b) =>
          a.wordAccuracyPct - b.wordAccuracyPct ||
          b.timingMeanAbsMs - a.timingMeanAbsMs
      )[0];
      if (worstSegment?.text) {
        return {
          index: worstSegment.segmentIndex ?? 0,
          text: worstSegment.text,
          source: "timing",
        };
      }
    }
    if (wordCoach?.rushedPhrases?.[0]) {
      return { index: -1, text: wordCoach.rushedPhrases[0], source: "lyrics" };
    }
    if (wordCoach?.latePhrases?.[0]) {
      return { index: -1, text: wordCoach.latePhrases[0], source: "lyrics" };
    }
    return null;
  }, [
    noteCoach?.worstNotes,
    dictionCoach?.worstWords,
    analysisReferencePayload.lines,
    analysisReferencePayload.words,
    pitchCoach,
    detailed?.segments,
    wordCoach?.rushedPhrases,
    wordCoach?.latePhrases,
  ]);

  const coachPriority = useMemo(
    () =>
      buildCoachPriority({
        pitchCoach,
        wordCoach,
        dictionCoach,
        noteCoach,
        breathCoach,
        timingMeanAbsMs: detailed?.timingMeanAbsMs ?? coachCore?.timingMetrics.meanAbsDeltaMs,
        paceRatio: detailed?.paceRatio ?? coachCore?.paceRatio,
        focusLine,
      }),
    [
      pitchCoach,
      wordCoach,
      dictionCoach,
      noteCoach,
      breathCoach,
      detailed?.timingMeanAbsMs,
      detailed?.paceRatio,
      coachCore?.timingMetrics.meanAbsDeltaMs,
      coachCore?.paceRatio,
      focusLine,
    ]
  );

  const drillPlan = useMemo(
    () => buildDrillPlan({ pitchCoach, wordCoach, practiceMode }),
    [pitchCoach, wordCoach, practiceMode]
  );

  const coachCards = useMemo(
    () =>
      buildCoachCards({
        dictionCoach,
        noteCoach,
        wordCoach,
        pitchCoach,
        breathCoach,
        coachCore,
      }),
    [dictionCoach, noteCoach, wordCoach, pitchCoach, breathCoach, coachCore]
  );

  const coachReport = useMemo(
    () =>
      buildCoachReport({
        coachPriority,
        coachCore,
        drillPlan,
        detailed,
        practiceMode,
      }),
    [coachPriority, coachCore, drillPlan, detailed, practiceMode]
  );

  const drillDelta = useMemo(
    () => (drillSession ? buildRepDelta(drillSession) : null),
    [drillSession]
  );

  const drillTargetLine = useMemo(() => {
    if (drillSession?.targetLineIndex === null || drillSession?.targetLineIndex === undefined) {
      return null;
    }
    return analysisReferencePayload.lines.find(
      (line) => line.index === drillSession.targetLineIndex
    );
  }, [analysisReferencePayload.lines, drillSession?.targetLineIndex]);

  const karaokeFocusLineIndex = useMemo(() => {
    if (coachMode && drillSession?.targetLineIndex !== undefined && drillSession?.targetLineIndex !== null) {
      return drillSession.targetLineIndex;
    }
    return coachPriority?.focusLine?.index ?? null;
  }, [coachMode, drillSession?.targetLineIndex, coachPriority?.focusLine?.index]);

  const liveCurrentWordIndex = liveCoachMetrics?.expectedWordIndexNow ?? null;
  const karaokeActiveHighlight = phase === "playing_ref";
  const isRecording = phase === "recording";

  const scoreBreakdown = useMemo(
    () => ({
      pitch:
        pitchCoach?.pitchAccuracyScore ??
        coachCore?.subscores.pitch ??
        scores?.pitch ??
        0,
      timing:
        coachCore?.subscores.timing ??
        detailed?.subscores.timing ??
        scores?.timing ??
        0,
      lyrics:
        scores?.words ??
        wordCoach?.wordAccuracyScore ??
        detailed?.subscores.wordAccuracy ??
        coachCore?.subscores.word ??
        0,
      stability:
        pitchCoach?.pitchStabilityScore ??
        coachCore?.subscores.stability ??
        scores?.stability ??
        0,
    }),
    [
      pitchCoach?.pitchAccuracyScore,
      pitchCoach?.pitchStabilityScore,
      coachCore?.subscores.pitch,
      coachCore?.subscores.timing,
      coachCore?.subscores.word,
      coachCore?.subscores.stability,
      detailed?.subscores.timing,
      detailed?.subscores.wordAccuracy,
      scores?.pitch,
      scores?.timing,
      scores?.stability,
      wordCoach?.wordAccuracyScore,
    ]
  );

  const sliceContour = useCallback(
    (contour: PitchContour, start: number, end: number): PitchContour => {
      const frames = contour.frames.filter((frame) => frame.t >= start && frame.t <= end);
      return {
        frames,
        sampleRate: contour.sampleRate,
        hopSec: contour.hopSec,
      };
    },
    []
  );

  const getReferencePitchContour = useCallback(() => {
    if (!referenceBufferRef.current || !upload) return null;
    const key = `${upload.id}-${activeSegment.start.toFixed(2)}-${activeSegment.end.toFixed(2)}`;
    const cached = referencePitchCacheRef.current.get(key);
    if (cached) return cached;
    const contour = extractPitchContourFromBuffer(
      referenceBufferRef.current,
      activeSegment.start,
      activeSegment.end,
      0.02,
      0.04
    );
    referencePitchCacheRef.current.set(key, contour);
    return contour;
  }, [activeSegment.end, activeSegment.start, upload]);

  const getReferenceNoteEvents = useCallback(() => {
    if (!referenceBufferRef.current || !upload) return null;
    const key = `${upload.id}-${activeSegment.start.toFixed(2)}-${activeSegment.end.toFixed(2)}`;
    const cached = referenceNoteCacheRef.current.get(key);
    if (cached) return cached;
    const contour = getReferencePitchContour();
    if (!contour) return null;
    const notes = extractNoteEvents(contour);
    referenceNoteCacheRef.current.set(key, notes);
    return notes;
  }, [activeSegment.end, activeSegment.start, getReferencePitchContour, upload]);

  const decodeRecordingBuffer = useCallback(async (blob: Blob) => {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    const audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => undefined);
    }
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close().catch(() => undefined);
    return buffer;
  }, []);

  const stopLiveFeedback = useCallback(() => {
    if (liveCoachRef.current) {
      liveCoachRef.current.stop();
    }
    liveCoachRef.current = null;
    lastLiveUpdateRef.current = null;
    lastLiveLabelsRef.current = {};
    setLiveCoachMetrics(null);
    setLiveUpdateHz(0);
    setLiveEvents([]);
  }, []);

  const isSessionActive = useCallback((sessionId: number) => sessionIdRef.current === sessionId, []);

  const isFatalMessage = (message?: string | null) => {
    if (!message) return false;
    return /no speech|microphone|reference transcript missing|recording too short/i.test(message);
  };

  const resetAttemptState = useCallback(() => {
    setScores(null);
    setMeters({ pitch: 0, timing: 0, stability: 0 });
    setRecordingTime(0);
    setCoachCore(null);
    setNoteCoach(null);
    setDictionCoach(null);
    setBreathCoach(null);
    setPitchCoach(null);
    setRecordingStats(null);
    setAnalysisError(null);
    setAutoLoopNote(null);
    setAnalysisBlocked(null);
    setEstimatedOffsetMs(null);
    pendingAttemptRef.current = null;
  }, []);

  const abortAll = useCallback(
    (reason = "abort", nextPhase: typeof phase = "ready") => {
      sessionIdRef.current += 1;
      const sessionId = sessionIdRef.current;
      recordingSessionRef.current = null;

      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setCountdown(null);

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (autoLoopTimeoutRef.current) {
        clearTimeout(autoLoopTimeoutRef.current);
        autoLoopTimeoutRef.current = null;
      }

      stopLiveFeedback();

      if (recordingStopRef.current) {
        const stop = recordingStopRef.current;
        recordingStopRef.current = null;
        stop().catch(() => undefined);
      }

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = activeSegment.start;
      }
      playbackSessionRef.current = null;

      if (isDev) {
        console.debug(`[live] abortAll(${reason}) session=${sessionId}`);
      }

      setAnalysisBlocked(null);
      pendingAttemptRef.current = null;

      setPhase(nextPhase);
      setRecordingTime(0);
      return sessionId;
    },
    [activeSegment.start, stopLiveFeedback]
  );

  const startLiveFeedback = useCallback(() => {
    if (!micStreamRef.current) return;
    stopLiveFeedback();
    const referenceContour = getReferencePitchContour();
    const referenceMedian = referenceContour
      ? computePitchMetrics(referenceContour).medianF0Hz
      : 0;
    const controller = startLiveCoach(
      micStreamRef.current,
      {
        words: analysisReferencePayload.words,
        lines: analysisReferencePayload.lines,
        durationSec: segmentDuration,
        medianF0Hz: referenceMedian,
      },
      { updateHz: 15 }
    );
    controller.onUpdate((metrics) => {
      if (phaseRef.current !== "recording") return;
      setLiveCoachMetrics(metrics);
      const now = performance.now();
      if (lastLiveUpdateRef.current) {
        const delta = now - lastLiveUpdateRef.current;
        if (delta > 0) {
          setLiveUpdateHz(Math.min(30, 1000 / delta));
        }
      }
      lastLiveUpdateRef.current = now;

      rmsSumRef.current += metrics.rms;
      rmsCountRef.current += 1;
      if (lastLiveTimeRef.current !== null) {
        const deltaSec = Math.max(0, metrics.t - lastLiveTimeRef.current);
        if (metrics.rms < SILENCE_RMS_THRESHOLD) {
          silenceDurationRef.current += deltaSec;
          if (silenceDurationRef.current >= SILENCE_WARN_SEC && !silenceWarnedRef.current) {
            silenceWarnedRef.current = true;
            toast({
              title: "We did not hear voice",
              description: "Move closer to the mic or increase input level.",
            });
          }
        } else {
          silenceDurationRef.current = 0;
        }
      }
      lastLiveTimeRef.current = metrics.t;

      const pitchScore =
        metrics.f0Hz && referenceMedian
          ? computePitchScore(metrics.f0Hz, referenceMedian)
          : 50;
      const timingScore = computeTimingScore(metrics.t);
      const stabilityScore = metrics.stability;
      setMeters({ pitch: pitchScore, timing: timingScore, stability: stabilityScore });
      setRecordingTime(metrics.t);
      setCurrentTime(activeSegment.start + metrics.t);

      if (metrics.t >= segmentDuration && recordingStopRef.current) {
        void stopRecording();
      }

      const prev = lastLiveLabelsRef.current;
      const nextEvents: string[] = [];
      if (prev.pitchLabel !== metrics.pitchLabel) {
        nextEvents.push(`pitch:${metrics.pitchLabel}`);
      }
      if (prev.timingLabel !== metrics.timingLabel) {
        nextEvents.push(`timing:${metrics.timingLabel}`);
      }
      if (prev.energyLabel !== metrics.energyLabel && metrics.energyLabel) {
        nextEvents.push(`energy:${metrics.energyLabel}`);
      }
      if (nextEvents.length) {
        setLiveEvents((current) => {
          const merged = [...current, ...nextEvents].slice(-5);
          return merged;
        });
      }
      lastLiveLabelsRef.current = {
        pitchLabel: metrics.pitchLabel,
        timingLabel: metrics.timingLabel,
        energyLabel: metrics.energyLabel,
      };
    });
    liveCoachRef.current = controller;
  }, [analysisReferencePayload.words, getReferencePitchContour, segmentDuration, stopLiveFeedback]);

  const analyzePitch = useCallback(
    async (blob: Blob, userBuffer?: AudioBuffer | null) => {
      setPitchAnalyzing(true);
      try {
        let contour: PitchContour;
        let userMetrics: PitchMetrics;
        if (userBuffer) {
          contour = extractPitchContourFromBuffer(
            userBuffer,
            0,
            userBuffer.duration,
            0.02,
            0.04
          );
          userMetrics = computePitchMetrics(contour);
        } else {
          const userResult = await extractPitchContourFromBlob(blob, 0.02);
          contour = userResult.contour;
          userMetrics = userResult.metrics;
        }

        const referenceContour = getReferencePitchContour();
        const referenceMetrics = referenceContour ? computePitchMetrics(referenceContour) : null;
        const referenceUsable =
          referenceMetrics && referenceMetrics.voicedPct >= 0.2;
        const comparison = referenceContour && referenceUsable
          ? comparePitchContours(referenceContour, contour)
          : null;

        const lineComparisons = analysisReferencePayload.lines.map((line) => {
          const userLineContour = sliceContour(contour, line.start, line.end);
          const userLineMetrics = computePitchMetrics(userLineContour);
          const refLineContour =
            referenceContour && referenceUsable
              ? sliceContour(referenceContour, line.start, line.end)
              : null;
          const lineComparison =
            refLineContour && referenceUsable
              ? comparePitchContours(refLineContour, userLineContour)
              : null;
          return {
            line: { index: line.index, text: line.text, start: line.start, end: line.end },
            comparison: lineComparison,
            userMetrics: userLineMetrics,
          };
        });

        const coach = buildPitchCoach({
          userMetrics,
          referenceMetrics,
          comparison,
          lineComparisons,
        });
        setPitchCoach(coach);
        const referenceNotes = getReferenceNoteEvents();
        const noteCoachResult = buildNoteCoach({
          userContour: contour,
          referenceContour: referenceContour ?? undefined,
          referenceNotes: referenceNotes ?? undefined,
        });
        setNoteCoach(noteCoachResult);
        return { userMetrics, coach, contour, noteCoach: noteCoachResult };
      } finally {
        setPitchAnalyzing(false);
      }
    },
    [analysisReferencePayload.lines, getReferenceNoteEvents, getReferencePitchContour, sliceContour]
  );

  const improvement = useMemo(() => {
    if (!detailed || !previousDetailed) return null;
    const accuracyDelta = Math.round(detailed.wordAccuracyPct - previousDetailed.wordAccuracyPct);
    const timingDelta = Math.round(previousDetailed.timingMeanAbsMs - detailed.timingMeanAbsMs);
    const paceDelta = Number((detailed.paceRatio - previousDetailed.paceRatio).toFixed(2));
    return { accuracyDelta, timingDelta, paceDelta };
  }, [detailed, previousDetailed]);

  const debugMetrics = useMemo(() => {
    const perWord = detailed?.perWord ?? [];
    const maxUserEnd = perWord
      .map((word) => word.userEnd ?? 0)
      .reduce((max, value) => Math.max(max, value), 0);
    const verseDuration = segmentDuration || 0;
    const coveragePct = verseDuration > 0 ? Math.min(1, maxUserEnd / verseDuration) : 0;
    return {
      voicedPct: pitchCoach?.voicedPct ?? 0,
      biasCents: pitchCoach?.biasCents ?? 0,
      medianAbsErrorCents: pitchCoach?.medianAbsErrorCents ?? 0,
      noteAccuracyScore: noteCoach?.noteAccuracyScore ?? 0,
      dictionClarityScore: dictionCoach?.clarityScore ?? 0,
      phrasingScore: breathCoach?.phrasingScore ?? 0,
      timingMeanAbsMs: detailed?.timingMeanAbsMs ?? coachCore?.timingMetrics.meanAbsDeltaMs ?? 0,
      wordAccuracyPct: detailed?.wordAccuracyPct ?? wordCoach?.wordAccuracyScore ?? 0,
      paceRatio: detailed?.paceRatio ?? coachCore?.paceRatio ?? 1,
      coveragePct,
      estimatedOffsetMs: estimatedOffsetMs ?? scores?.alignment?.estimatedOffsetMs ?? 0,
    };
  }, [
    detailed?.perWord,
    detailed?.timingMeanAbsMs,
    detailed?.wordAccuracyPct,
    detailed?.paceRatio,
    coachCore?.timingMetrics.meanAbsDeltaMs,
    coachCore?.paceRatio,
    pitchCoach?.voicedPct,
    pitchCoach?.biasCents,
    pitchCoach?.medianAbsErrorCents,
    noteCoach?.noteAccuracyScore,
    dictionCoach?.clarityScore,
    breathCoach?.phrasingScore,
    wordCoach?.wordAccuracyScore,
    segmentDuration,
    estimatedOffsetMs,
    scores?.alignment?.estimatedOffsetMs,
  ]);

  const worstDeltas = useMemo(() => {
    if (!detailed?.perWord) return [];
    return [...detailed.perWord]
      .filter((word) => typeof word.deltaMs === "number")
      .sort((a, b) => Math.abs(b.deltaMs ?? 0) - Math.abs(a.deltaMs ?? 0))
      .slice(0, 10);
  }, [detailed?.perWord]);

  const handleCopyAnalysis = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          { pitchCoach, noteCoach, dictionCoach, breathCoach, wordCoach, coachCore, detailed },
          null,
          2
        )
      );
      toast({ title: "Copied", description: "Analysis JSON copied to clipboard." });
    } catch (err) {
      toast({ title: "Copy failed", description: "Clipboard access not available." });
    }
  };

  useEffect(() => {
    if (!audioRef.current || !audioUrl) return;
    const audio = audioRef.current;
    const onLoaded = () => setAudioDuration(audio.duration || 0);
    audio.addEventListener("loadedmetadata", onLoaded);
    return () => audio.removeEventListener("loadedmetadata", onLoaded);
  }, [audioUrl]);

  useEffect(() => {
    if (!audioUrl) return;
    let cancelled = false;
    const loadBuffer = async () => {
      try {
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        if (!cancelled) {
          referenceBufferRef.current = buffer;
        }
        void audioContext.close();
      } catch (err) {
        console.error("Failed to decode reference audio", err);
      }
    };
    loadBuffer();
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!upload) return;
    void fetchHistory(upload.id);
  }, [upload, fetchHistory]);

  useEffect(() => {
    let cancelled = false;
    const restoreLatestUpload = async () => {
      if (upload) return;
      try {
        const response = await fetch("/api/live-coaching/latest-upload", {
          credentials: "include",
        });
        if (!response.ok) return;
        const latest = (await response.json()) as UploadResponse;
        if (cancelled) return;
        setUpload(latest);
        setAudioUrl(latest.publicUrl);
        setPhase((prev) => (prev === "idle" ? "uploaded" : prev));
        void fetchHistory(latest.id);
      } catch (err) {
        console.warn("Failed to restore latest upload", err);
      }
    };
    void restoreLatestUpload();
    return () => {
      cancelled = true;
    };
  }, [upload, fetchHistory]);

  useEffect(() => {
    if (audioUrl && !micReady) {
      void initMic().catch(() => undefined);
    }
  }, [audioUrl, micReady, initMic]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      stopLiveFeedback();
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stopLiveFeedback]);

  useEffect(() => {
    if (!isDev) return;
    console.debug(`[live] phase=${phase} session=${sessionIdRef.current}`);
  }, [phase, isDev]);

  useEffect(() => {
    if (!lyricsText) return;
    const built = buildVerses(lyricsText, segments, audioDuration);
    setVerses(built);
  }, [lyricsText, segments, audioDuration]);

  useEffect(() => {
    if (selectedVerse >= verses.length) {
      setSelectedVerse(0);
    }
  }, [verses.length, selectedVerse]);

  useEffect(() => {
    if (!coachMode || !scores || analysisSeq === 0) return;
    if (analysisSeq === lastDrillSeqRef.current) return;
    lastDrillSeqRef.current = analysisSeq;

    const metrics = extractUnifiedMetrics({
      scores,
      detailed: scores.detailed ?? null,
      pitchCoach,
      noteCoach,
      dictionCoach,
      breathCoach,
      segmentDurationSec: segmentDuration,
    });

    const selection = selectDrillFocus({
      metrics,
      detailed: scores.detailed ?? null,
      pitchCoach,
      dictionCoach,
      noteCoach,
      breathCoach,
      focusLineIndex: focusLine?.index ?? null,
      practiceMode,
    });

    setDrillSession((prev) => {
      let session = prev;
      if (!session || session.status !== "active" || session.focus !== selection.focus) {
        session = createDrillSession(selection);
      } else {
        session = {
          ...session,
          title: selection.title,
          targetLineIndex: selection.targetLineIndex ?? session.targetLineIndex,
          targetSegmentIndex: selection.targetSegmentIndex ?? session.targetSegmentIndex,
        };
      }
      const nextSession = appendDrillRep(session, metrics);
      if (nextSession.status === "failed") {
        const altSelection = selectDrillFocus({
          metrics,
          detailed: scores.detailed ?? null,
          pitchCoach,
          dictionCoach,
          noteCoach,
          breathCoach,
          focusLineIndex: focusLine?.index ?? null,
          practiceMode,
          avoidFocus: nextSession.focus,
        });
        if (altSelection.focus !== nextSession.focus) {
          toast({
            title: "Switching drill",
            description: `No improvement detected. Switching to ${altSelection.title}.`,
          });
          return createDrillSession(altSelection);
        }
      }
      return nextSession;
    });
  }, [
    analysisSeq,
    coachMode,
    scores,
    pitchCoach,
    noteCoach,
    dictionCoach,
    breathCoach,
    segmentDuration,
    focusLine?.index,
    practiceMode,
  ]);

  useEffect(() => {
    setPreviousDetailed(null);
    setScores((prev) => (prev ? { ...prev, detailed: undefined } : prev));
    setCoachCore(null);
    setPitchCoach(null);
    setDrillSession(null);
  }, [selectedVerse, verseCount, upload?.id]);

  useEffect(() => {
    if (!referenceBufferRef.current || activeVerses.length === 0) return;
    const buffer = referenceBufferRef.current;
    referenceContourRef.current = extractPitchContour(
      buffer,
      activeSegment.start,
      activeSegment.end
    );
  }, [activeSegment.start, activeSegment.end, activeVerses.length]);

  const resetPlayback = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = activeSegment.start;
  };

  const stopRaf = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const updatePlaybackTime = () => {
    if (!audioRef.current) return;
    if (playbackSessionRef.current !== sessionIdRef.current) {
      stopRaf();
      return;
    }
    const audio = audioRef.current;
    setCurrentTime(audio.currentTime);
    const effectiveEnd =
      activeSegment.end > 0
        ? Math.min(activeSegment.end, audio.duration || activeSegment.end)
        : audio.duration || 0;
    if (effectiveEnd > 0 && audio.currentTime >= effectiveEnd) {
      audio.pause();
      audio.currentTime = activeSegment.start;
      stopRaf();
      if (phaseRef.current === "playing_ref" && playModeRef.current === "practice") {
        startCountdown(sessionIdRef.current);
      } else {
        setPhase("ready");
      }
      return;
    }
    rafRef.current = requestAnimationFrame(updatePlaybackTime);
  };

  const waitForCanPlay = (audio: HTMLAudioElement, sessionId: number) =>
    new Promise<void>((resolve, reject) => {
      if (audio.readyState >= 2) {
        resolve();
        return;
      }
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Audio failed to load"));
      };
      const cleanup = () => {
        audio.removeEventListener("canplay", onReady);
        audio.removeEventListener("loadeddata", onReady);
        audio.removeEventListener("error", onError);
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve();
      }, 2000);
      const originalCleanup = cleanup;
      const cleanupWithTimeout = () => {
        window.clearTimeout(timeout);
        originalCleanup();
      };
      audio.addEventListener("canplay", () => {
        cleanupWithTimeout();
        resolve();
      });
      audio.addEventListener("loadeddata", () => {
        cleanupWithTimeout();
        resolve();
      });
      audio.addEventListener("error", () => {
        cleanupWithTimeout();
        reject(new Error("Audio failed to load"));
      });
    }).then(() => {
      if (!isSessionActive(sessionId)) throw new Error("Session changed");
    });

  const playReference = async (sessionId: number, mode: "practice" | "reference") => {
    if (!audioRef.current || !audioUrl) return;
    if (segmentDuration <= 0) {
      toast({
        title: "Audio not ready",
        description: "Wait for the track to load or paste lyrics to set a verse range.",
        variant: "destructive",
      });
      return;
    }
    playbackSessionRef.current = sessionId;
    playModeRef.current = mode;
    setPhase("playing_ref");
    try {
      await waitForCanPlay(audioRef.current, sessionId);
      if (!isSessionActive(sessionId)) return;
      resetPlayback();
      await audioRef.current.play();
      stopRaf();
      rafRef.current = requestAnimationFrame(updatePlaybackTime);
    } catch (err) {
      if (isDev) {
        console.debug("playReference failed", err);
      }
      setPhase("ready");
    }
  };

  const ensureMicReady = async () => {
    if (micReady) return true;
    setPhase("priming");
    try {
      await initMic();
      setMicError(null);
      return true;
    } catch (err) {
      console.error(err);
      const errorName = err instanceof Error ? err.name : "";
      const denied =
        errorName === "NotAllowedError" || errorName === "PermissionDeniedError";
      setMicError(
        denied
          ? "Microphone permission denied. Enable it in your browser settings."
          : "Microphone unavailable. Check input device settings."
      );
      toast({
        title: "Microphone error",
        description: denied
          ? "Microphone permission denied. Enable it in your browser settings."
          : "Allow microphone access to record.",
        variant: "destructive",
      });
      setPhase("ready");
      return false;
    }
  };

  const resetCalibration = () => {
    setCalibrationMetrics(null);
    setCalibrationStatus("idle");
    setCalibrationIssues([]);
    setCalibrationGuidance([]);
    setCalibrationOverride(false);
  };

  const handleCalibration = async () => {
    if (calibrationStatus === "running") return;
    const sessionId = abortAll("calibration", "calibrating");
    calibrationSessionRef.current = sessionId;
    resetCalibration();
    setCalibrationStatus("running");
    const ok = await ensureMicReady();
    if (!ok || !isSessionActive(sessionId)) {
      setCalibrationStatus("failed");
      setPhase("calibration_failed");
      return;
    }
    if (!micStreamRef.current) {
      setCalibrationStatus("failed");
      setPhase("calibration_failed");
      toast({
        title: "Microphone unavailable",
        description: "Check your input device and try again.",
        variant: "destructive",
      });
      return;
    }
    try {
      const sample = await recordCalibrationSample(micStreamRef.current, 3);
      if (!isSessionActive(sessionId)) return;
      const metrics = sample.metrics;
      const evaluation = evaluateCalibration(metrics);
      setCalibrationMetrics(metrics);
      setCalibrationIssues(evaluation.issues);
      setCalibrationGuidance(evaluation.guidance);
      setCalibrationStatus(evaluation.pass ? "passed" : "failed");
      setPhase(evaluation.pass ? "ready" : "calibration_failed");
    } catch (err) {
      console.error("Calibration failed", err);
      setCalibrationStatus("failed");
      setPhase("calibration_failed");
      toast({
        title: "Calibration failed",
        description: "Try again and make sure the mic is connected.",
        variant: "destructive",
      });
    }
  };

  const handleOverrideCalibration = () => {
    setCalibrationOverride(true);
    setPhase("ready");
  };

  const startCountdown = (sessionId: number) => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setPhase("countdown");
    setCountdown(3);
    setRecordingTime(0);
    let remaining = 3;
    const interval = window.setInterval(() => {
      if (!isSessionActive(sessionId)) {
        clearInterval(interval);
        countdownRef.current = null;
        return;
      }
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        countdownRef.current = null;
        setCountdown(null);
        void startRecording(sessionId);
      }
    }, 1000);
    countdownRef.current = interval;
  };

  const startRecording = async (sessionId: number) => {
    if (!audioUrl) {
      toast({
        title: "Upload audio first",
        description: "Choose a reference track before recording.",
        variant: "destructive",
      });
      return;
    }
    if (
      [
        "priming",
        "recording",
        "stopping",
        "uploading_attempt",
        "analyzing_attempt",
        "calibrating",
      ].includes(phaseRef.current)
    ) {
      return;
    }
    if (recordingStopRef.current) return;
    if (!micReady) {
      const ok = await ensureMicReady();
      if (!ok) return;
    }
    try {
      if (!isSessionActive(sessionId)) return;
      setPhase("recording");
      setAnalysisError(null);
      setAnalysisBlocked(null);
      recentPitchRef.current = [];
      setRecordingTime(0);
      silenceDurationRef.current = 0;
      silenceWarnedRef.current = false;
      rmsSumRef.current = 0;
      rmsCountRef.current = 0;
      lastLiveTimeRef.current = null;
      if (!micStreamRef.current) {
        throw new Error("Microphone not ready");
      }
      const controller = await startRecorder(micStreamRef.current);
      if (!isSessionActive(sessionId)) {
        await controller.stop().catch(() => undefined);
        return;
      }
      recordingStopRef.current = controller.stop;
      recordingSessionRef.current = sessionId;
      startLiveFeedback();
    } catch (err) {
      console.error(err);
      stopLiveFeedback();
      toast({ title: "Microphone error", description: "Allow microphone access to record.", variant: "destructive" });
      setPhase("ready");
    }
  };

  const stopRecording = async () => {
    if (phaseRef.current !== "recording") return;
    if (!recordingStopRef.current) return;
    const sessionId = recordingSessionRef.current;
    recordingSessionRef.current = null;
    if (!sessionId || !isSessionActive(sessionId)) return;
    stopLiveFeedback();
    setPhase("stopping");
    const stop = recordingStopRef.current;
    recordingStopRef.current = null;
    try {
      const result = await stop();
      if (!isSessionActive(sessionId)) return;
      if (result.durationSec < 2.5) {
        toast({
          title: "Recording too short",
          description: "Record at least 3 seconds for better feedback.",
        });
        setPhase("ready");
        setRecordingTime(0);
        return;
      }

      const userBuffer = await decodeRecordingBuffer(result.blob).catch(() => null);
      const pitchAnalysis = await analyzePitch(result.blob, userBuffer).catch(() => null);
      if (!isSessionActive(sessionId)) return;
      const avgRms =
        rmsCountRef.current > 0 ? rmsSumRef.current / rmsCountRef.current : 0;
      const computed = await scoreAttempt(
        result.blob,
        result.durationSec,
        pitchAnalysis?.userMetrics,
        userBuffer
      );
      if (!isSessionActive(sessionId)) return;
      if (!computed) {
        setRecordingTime(0);
        return;
      }
      if (userBuffer) {
        const diction = await buildDictionCoach({
          userBuffer,
          referenceWords: analysisReferencePayload.words,
          alignment: computed?.detailed ? { perWord: computed.detailed.perWord } : null,
        });
        setDictionCoach(diction);

        if (pitchAnalysis?.contour) {
          const breath = buildBreathCoach({
            userBuffer,
            userContour: pitchAnalysis.contour,
            referenceLines: analysisReferencePayload.lines,
          });
          setBreathCoach(breath);
        }
      }
      if (!isSessionActive(sessionId)) return;
      setScores(computed);
      setAnalysisError(null);
      setMeters({ pitch: computed.pitch, timing: computed.timing, stability: computed.stability });
      setPhase("showing_feedback");
      setRecordingTime(0);
      analysisSeqRef.current += 1;
      setAnalysisSeq(analysisSeqRef.current);
      if (
        computed.detailed?.message &&
        computed.detailed.message.toLowerCase().includes("no speech") &&
        avgRms > SILENCE_RMS_THRESHOLD * 2
      ) {
        toast({
          title: "Speech unclear",
          description: "We detected audio but could not decode speech. Try clearer words or less background sound.",
        });
      }
      scheduleCoachLoop(sessionId, computed);
    } catch (err) {
      console.error(err);
      setAnalysisError(err instanceof Error ? err.message : String(err));
      toast({
        title: "Recording error",
        description: "Try recording again.",
        variant: "destructive",
      });
      if (isSessionActive(sessionId)) {
        setPhase("showing_feedback");
        setScores({
          overall: 0,
          pitch: 0,
          timing: 0,
          stability: 0,
          label: "Recording",
          tips: ["Recording failed. Try again and check microphone input."],
          detailed: {
            wordAccuracyPct: 0,
            timingMeanAbsMs: 0,
            paceRatio: 1,
            perWord: [],
            segments: [],
            coachTips: ["Recording failed. Try again and check microphone input."],
            nextDrill: { type: "accuracy_clean", note: "Retry with clearer audio." },
            subscores: { wordAccuracy: 0, timing: 0, pace: 0 },
            missedWords: [],
            extraWords: [],
            message: "Recording failed. Try again.",
          },
        });
      }
    } finally {
      silenceDurationRef.current = 0;
      silenceWarnedRef.current = false;
    }
  };

  const startPracticeFlow = useCallback(
    async (sessionId: number) => {
      if (!audioUrl) return;
      if (!canRecord) {
        setPhase(calibrationStatus === "failed" ? "calibration_failed" : "ready");
        toast({
          title: "Mic check required",
          description: "Run the mic calibration before recording.",
        });
        return;
      }
      if (!isSessionActive(sessionId)) return;
      setPhase("priming");
      const ok = await ensureMicReady();
      if (!ok || !isSessionActive(sessionId)) return;
      await playReference(sessionId, "practice");
    },
    [audioUrl, canRecord, calibrationStatus, ensureMicReady, isSessionActive, playReference, toast]
  );

  const scheduleCoachLoop = useCallback(
    (sessionId: number, computed: LiveScores) => {
      if (!coachLoopRef.current) {
        setAutoLoopNote("coachLoop off");
        return;
      }
      const message = computed.detailed?.message ?? "";
      if (isFatalMessage(message)) {
        setAutoLoopNote("fatal message - loop skipped");
        return;
      }
      if (computed.overall >= SCORE_THRESHOLD) {
        setAutoLoopNote("score above threshold - loop skipped");
        return;
      }
      if (autoLoopTimeoutRef.current) {
        clearTimeout(autoLoopTimeoutRef.current);
      }
      setAutoLoopNote("loop scheduled");
      autoLoopTimeoutRef.current = window.setTimeout(() => {
        if (!isSessionActive(sessionId)) return;
        if (!coachLoopRef.current) return;
        if (phaseRef.current !== "showing_feedback") return;
        resetAttemptState();
        const nextSession = abortAll("coach-loop");
        void startPracticeFlow(nextSession);
      }, 3000);
    },
    [abortAll, isFatalMessage, resetAttemptState, startPracticeFlow]
  );

  const handlePlayReference = () => {
    if (!audioUrl) return;
    const sessionId = abortAll("play-reference");
    void playReference(sessionId, "reference");
  };

  const handleRecord = async () => {
    if (
      [
        "priming",
        "recording",
        "stopping",
        "uploading_attempt",
        "analyzing_attempt",
        "countdown",
        "calibrating",
      ].includes(phaseRef.current)
    ) {
      return;
    }
    if (phase !== "ready" && phase !== "showing_feedback" && phase !== "uploaded") return;
    if (!audioUrl) {
      toast({ title: "Upload audio first", description: "Choose a reference track.", variant: "destructive" });
      return;
    }
    if (!canRecord) {
      toast({
        title: "Mic check required",
        description: "Run the mic calibration before recording (or choose Record anyway).",
      });
      setPhase(calibrationStatus === "failed" ? "calibration_failed" : "ready");
      return;
    }
    const sessionId = abortAll("record");
    void startPracticeFlow(sessionId);
  };

  const handleStop = () => {
    if (phase === "recording") {
      void stopRecording();
      return;
    }
    abortAll("stop");
  };

  const handleEnableMic = async () => {
    await ensureMicReady();
  };

  const handleSkipDrill = () => {
    setDrillSession((prev) => (prev ? { ...prev, status: "failed" } : prev));
  };

  const handleRetry = async () => {
    resetAttemptState();
    abortAll("reroll");
  };

  const handleAnalyzeAnyway = async () => {
    if (!pendingAttemptRef.current) return;
    const prepared = pendingAttemptRef.current;
    pendingAttemptRef.current = null;
    setAnalysisBlocked(null);
    const sessionId = abortAll("force-analyze", "uploading_attempt");
    try {
      const computed = await runAnalysisFromPrepared(prepared, true);
      if (!isSessionActive(sessionId)) return;
      setScores(computed);
      setAnalysisError(null);
      setMeters({ pitch: computed.pitch, timing: computed.timing, stability: computed.stability });
      setPhase("showing_feedback");
      setRecordingTime(0);
      analysisSeqRef.current += 1;
      setAnalysisSeq(analysisSeqRef.current);
      scheduleCoachLoop(sessionId, computed);
    } catch (err) {
      console.error(err);
      toast({
        title: "Analysis failed",
        description: "Try recording again.",
        variant: "destructive",
      });
      setPhase("ready");
    }
  };

  const handleToggleCoachMode = () => {
    setCoachMode((prev) => {
      const next = !prev;
      if (next) {
        lastDrillSeqRef.current = 0;
      }
      return next;
    });
  };

  const handlePrev = () => {
    const nextIndex = Math.max(0, selectedVerse - 1);
    setSelectedVerse(nextIndex);
  };

  const handleNext = () => {
    const nextIndex = Math.min(verses.length - 1, selectedVerse + 1);
    setSelectedVerse(nextIndex);
  };

  const handleUpload = async (file: File) => {
    setPhase("analyzing");
    try {
      const form = new FormData();
      form.append("audio", file);
      const response = await fetch("/api/uploads/audio", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!response.ok) throw new Error("Upload failed");
      const data = (await response.json()) as UploadResponse;
      setUpload(data);
      setAudioUrl(data.publicUrl);
      setLyricsText("");
      setSegments([]);
      setVerses([]);
      setScores(null);
      setPreviousDetailed(null);
      setCoachCore(null);
      setPitchCoach(null);
      setNoteCoach(null);
      setDictionCoach(null);
      setBreathCoach(null);
      setDrillSession(null);
      resetCalibration();
      setTranscribeDisabled(false);
      setAnalysisBlocked(null);
      analysisSeqRef.current = 0;
      lastDrillSeqRef.current = 0;
      setAnalysisSeq(0);
      setMeters({ pitch: 0, timing: 0, stability: 0 });
      setCurrentTime(0);
      setPhase("uploaded");
      void initMic().catch(() => {
        setMicReady(false);
        toast({
          title: "Microphone permission",
          description: "Enable the mic to record your verse.",
        });
      });
    } catch (err) {
      console.error(err);
      toast({ title: "Upload failed", description: "Try a different file.", variant: "destructive" });
      setPhase("idle");
    }
  };

  const handleTranscribe = async () => {
    if (!upload) return;
    if (transcribeDisabled) {
      toast({
        title: "Transcription disabled",
        description: "Paste lyrics manually to continue.",
      });
      return;
    }
    setPhase("analyzing");
    try {
      const payload: Record<string, unknown> = {
        uploadId: upload.id,
        mode: quickMode ? "quick" : "full",
      };
      if (quickMode) {
        payload.startSec = 0;
        payload.endSec = audioDuration > 0 ? Math.min(60, audioDuration) : 60;
      }
      if (audioDuration > 0) {
        payload.durationSec = audioDuration;
      }
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const body = await response.json().catch(() => ({}));
      const requestId =
        typeof body?.requestId === "string"
          ? body.requestId
          : response.headers.get("x-request-id");
      if (!response.ok) {
        const code = typeof body?.code === "string" ? body.code : undefined;
        const message = typeof body?.message === "string" ? body.message : "Transcription failed.";
        const hint = getTranscribeHint(code);
        if (code === "ASSEMBLYAI_QUOTA_EXCEEDED") {
          setTranscribeDisabled(true);
        }
        toast({
          title: `Transcription failed${code ? ` (${code})` : ""}`,
          description: `${message} ${hint}${requestId ? ` (Request ID: ${requestId})` : ""}`.trim(),
          variant: "destructive",
        });
        setPhase("ready");
        return;
      }
      const warnings = Array.isArray(body?.warnings) ? body.warnings : [];
      if (warnings.length > 0) {
        toast({
          title: "Transcription warning",
          description: warnings.join(" "),
        });
      }
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text) {
        toast({
          title: "No lyrics detected",
          description: "Paste lyrics manually to continue.",
        });
        if (!lyricsText) {
          setLyricsText("");
          setSegments([]);
          setVerses([]);
          setScores(null);
          setCoachCore(null);
          setPitchCoach(null);
          setDrillSession(null);
          analysisSeqRef.current = 0;
          lastDrillSeqRef.current = 0;
          setAnalysisSeq(0);
          setMeters({ pitch: 0, timing: 0, stability: 0 });
        }
        setPhase("ready");
        return;
      }
      setLyricsText(text);
      setSegments(Array.isArray(body?.segments) ? body.segments : []);
      setScores(null);
      setPreviousDetailed(null);
      setCoachCore(null);
      setPitchCoach(null);
      setDrillSession(null);
      analysisSeqRef.current = 0;
      lastDrillSeqRef.current = 0;
      setAnalysisSeq(0);
      setMeters({ pitch: 0, timing: 0, stability: 0 });
      setPhase("ready");
    } catch (err) {
      console.error(err);
      toast({
        title: "Transcription failed",
        description: "Paste lyrics manually to continue.",
        variant: "destructive",
      });
      setPhase("ready");
    }
  };

  const handleManualLyrics = () => {
    if (!manualLyrics.trim()) {
      toast({ title: "Paste lyrics", description: "Add lyrics to continue.", variant: "destructive" });
      return;
    }
    setLyricsText(manualLyrics.trim());
    setSegments([]);
    setScores(null);
    setPreviousDetailed(null);
    setCoachCore(null);
    setPitchCoach(null);
    setDrillSession(null);
    analysisSeqRef.current = 0;
    lastDrillSeqRef.current = 0;
    setAnalysisSeq(0);
    setMeters({ pitch: 0, timing: 0, stability: 0 });
    setPhase("ready");
  };

  const uploadRecording = async (blob: Blob, durationSec: number): Promise<RecordingUploadResponse> => {
    const form = new FormData();
    form.append("audio", blob, `recording-${Date.now()}.webm`);
    form.append("durationSec", durationSec.toString());
    const response = await fetch("/api/recordings/upload", {
      method: "POST",
      body: form,
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Recording upload failed");
    }
    return (await response.json()) as RecordingUploadResponse;
  };

  const requestAnalysis = async (payload: Record<string, unknown>): Promise<AnalysisResponse> => {
    const run = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch("/api/analyze-performance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const message = typeof body?.message === "string" ? body.message : "Analysis failed";
          const code = typeof body?.code === "string" ? body.code : undefined;
          const requestId =
            typeof body?.requestId === "string"
              ? body.requestId
              : response.headers.get("x-request-id") ?? undefined;
          const error = new Error(
            requestId ? `${message} (Request ID: ${requestId})` : message
          );
          (error as any).code = code;
          (error as any).requestId = requestId;
          throw error;
        }
        return (await response.json()) as AnalysisResponse;
      } finally {
        window.clearTimeout(timeout);
      }
    };

    try {
      return await run();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const isNetwork = name === "AbortError" || err instanceof TypeError;
      if (isNetwork) {
        return await run();
      }
      throw err;
    }
  };

  const computePitchScore = (pitchHz: number, referenceHz: number) => {
    if (pitchHz <= 0 || referenceHz <= 0) return 50;
    const diff = Math.abs(centsOff(referenceHz, pitchHz));
    return Math.max(0, 100 - Math.min(100, diff * 2));
  };

  const computeTimingScore = (elapsedSec: number) => {
    if (!activeSegment.lines.length) return 70;
    const words = activeSegment.lines.flatMap((line) => line.words);
    const target = words.find((word) => word.start >= activeSegment.start + elapsedSec) ?? words[words.length - 1];
    const diff = Math.abs(target.start - (activeSegment.start + elapsedSec));
    return Math.max(0, 100 - Math.min(100, (diff / 0.3) * 100));
  };

  const computeStabilityScore = (pitchHz: number) => {
    if (pitchHz <= 0) return 40;
    recentPitchRef.current.push(pitchHz);
    if (recentPitchRef.current.length > 20) {
      recentPitchRef.current.shift();
    }
    const mean =
      recentPitchRef.current.reduce((acc, val) => acc + val, 0) / recentPitchRef.current.length;
    const variance =
      recentPitchRef.current.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
      recentPitchRef.current.length;
    const std = Math.sqrt(variance);
    const centsStd = mean > 0 ? 1200 * Math.log2((mean + std) / mean) : 0;
    return Math.max(0, 100 - Math.min(100, centsStd * 4));
  };

  const getReferencePitchAt = (timeSec: number) => {
    const contour = referenceContourRef.current;
    if (!contour || contour.length === 0) return 0;
    const index = Math.min(
      contour.length - 1,
      Math.max(0, Math.floor((timeSec - activeSegment.start) / 0.05))
    );
    return contour[index]?.frequency || 0;
  };

  const runAnalysisFromPrepared = async (
    prepared: PreparedAttempt,
    forceAnalyze = false
  ): Promise<LiveScores> => {
    let recordingMeta: RecordingUploadResponse | null = null;
    try {
      setPhase("uploading_attempt");
      recordingMeta = await uploadRecording(prepared.blob, prepared.durationSec);
    } catch (err) {
      console.error(err);
      toast({
        title: "Recording upload failed",
        description: "Scoring locally instead.",
        variant: "destructive",
      });
    }

    try {
      setPhase("analyzing_attempt");
      const analysis = await requestAnalysis({
        referenceAudioUrl: audioUrl,
        recordingUrl: recordingMeta?.recordingUrl,
        recordingId: recordingMeta?.id,
        verseStartSec: activeSegment.start,
        verseEndSec: activeSegment.end,
        lyricsText,
        referenceDurationSec: segmentDuration,
        recordingDurationSec: prepared.userBuffer.duration,
        referenceContour: prepared.refContour,
        recordingContour: prepared.userContour,
        referenceEnvelope: prepared.referenceEnvelope,
        recordingEnvelope: prepared.userEnvelope,
        referenceWords: analysisReferencePayload.words.map((word) => ({
          word: word.word,
          start: word.start,
          end: word.end,
          lineIndex: word.lineIndex,
          wordIndex: word.wordIndex,
        })),
        referenceLines: analysisReferencePayload.lines,
        estimatedOffsetMs: prepared.estimatedOffsetMs,
        practiceMode,
        calibrationMetrics: calibrationMetrics ?? undefined,
        forceAnalyze,
        debugTiming: Boolean((window as any).__debugTiming),
      });

      const combinedWarnings = [
        ...(analysis.warnings ?? []),
        ...(analysis.detailed?.warnings ?? []),
      ];
      if (combinedWarnings.length > 0) {
        toast({
          title: "Analysis warning",
          description: combinedWarnings.join(" "),
        });
      }
      if (analysis.detailed?.message) {
        toast({
          title: "Transcription note",
          description: analysis.detailed.message,
        });
      }

      if (analysis.detailed) {
        const core = buildCoachFeedback({
          perWord: analysis.detailed.perWord,
          pitchMetrics: prepared.pitchMetrics,
          serverPitchScore: analysis.pitch,
          serverStabilityScore: analysis.stability,
          paceRatio: analysis.detailed.paceRatio,
        });
        setCoachCore(core);
      } else {
        setCoachCore(null);
      }

      await saveAttemptSummary(
        analysis.overall,
        analysis.pitch,
        analysis.timing,
        analysis.stability,
        analysis.words ?? analysis.detailed?.subscores?.wordAccuracy ?? 0,
        analysis.label,
        analysis.tips,
        analysis.detailed
      );

      setPreviousDetailed(scores?.detailed ?? null);

      return {
        overall: analysis.overall,
        pitch: analysis.pitch,
        timing: analysis.timing,
        stability: analysis.stability,
        words: analysis.words ?? analysis.detailed?.subscores?.wordAccuracy,
        label: analysis.label,
        tips: analysis.tips,
        detailed: analysis.detailed,
        alignment: analysis.alignment,
        practiceMode,
      };
    } catch (err) {
      console.error(err);
      setAnalysisError(err instanceof Error ? err.message : String(err));
      toast({
        title: "Analysis failed",
        description: err instanceof Error ? err.message : "Unable to analyze the recording.",
        variant: "destructive",
      });
    }

    const voicedRatio =
      prepared.refContour.filter((s) => s.frequency > 0).length /
      Math.max(1, prepared.refContour.length);

    let pitchScore = 0;
    let label = "Pitch Accuracy";
    if (voicedRatio < 0.3) {
      label = "Tone Match";
      pitchScore = Math.round(energyCorrelation(prepared.referenceEnvelope, prepared.userEnvelope) * 100);
    } else {
      const avgCents = averageAbsoluteCentsDiff(prepared.refContour, prepared.userContour);
      pitchScore = Math.max(0, Math.round(100 - Math.min(100, avgCents * 2)));
    }

    const durationForScoring = Math.max(segmentDuration, 0.1);
    const timingScore = Math.max(
      0,
      Math.round(
        100 - Math.min(100, (Math.abs(prepared.userBuffer.duration - segmentDuration) / durationForScoring) * 120)
      )
    );

    const stabilityScore = pitchStabilityScore(prepared.userContour);
    const overall = Math.round(pitchScore * 0.5 + timingScore * 0.3 + stabilityScore * 0.2);

    const tips = buildTips({
      pitchScore,
      timingScore,
      stabilityScore,
      label,
      refContour: prepared.refContour,
      userContour: prepared.userContour,
    });

    const fallbackCore = buildCoachFeedback({
      perWord: [],
      pitchMetrics: prepared.pitchMetrics,
      serverPitchScore: pitchScore,
      serverStabilityScore: stabilityScore,
      paceRatio: segmentDuration > 0 ? prepared.userBuffer.duration / segmentDuration : 1,
    });
    setCoachCore(fallbackCore);

    await saveAttemptSummary(overall, pitchScore, timingScore, stabilityScore, 0, label, tips, null);

    return {
      overall,
      pitch: pitchScore,
      timing: timingScore,
      stability: stabilityScore,
      words: 0,
      label,
      tips,
      practiceMode,
    };
  };

  const scoreAttempt = async (
    blob: Blob,
    durationSec: number,
    pitchMetrics?: PitchMetrics,
    userBufferOverride?: AudioBuffer | null,
    forceAnalyze = false
  ): Promise<LiveScores | null> => {
    if (!referenceBufferRef.current) {
      return {
        overall: 0,
        pitch: 0,
        timing: 0,
        stability: 0,
        label: "Pitch Accuracy",
        tips: ["Reference audio not loaded. Please retry."],
      };
    }

    let audioContext: AudioContext | null = null;
    let userBuffer = userBufferOverride ?? null;
    if (!userBuffer) {
      audioContext = new AudioContext();
      userBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    }
    if (!userBuffer) {
      throw new Error("Unable to decode recording");
    }
    const referenceBuffer = referenceBufferRef.current;

    const refContour = extractPitchContour(
      referenceBuffer,
      activeSegment.start,
      activeSegment.end
    );
    const userContour = extractPitchContour(userBuffer, 0, userBuffer.duration);

    const referenceEnvelope = computeEnergyEnvelope(referenceBuffer, activeSegment.start, activeSegment.end);
    const userEnvelope = computeEnergyEnvelope(userBuffer, 0, userBuffer.duration);
    const offsetEstimate = estimateAlignmentOffsetMs(referenceEnvelope, userEnvelope, {
      stepSec: 0.05,
      maxOffsetMs: 800,
    });
    setEstimatedOffsetMs(offsetEstimate.offsetMs);

    const silenceThreshold = Math.max(
      SILENCE_RMS_THRESHOLD,
      calibrationMetrics?.noiseFloor ?? 0
    );
    const silence = analyzeSilence(userEnvelope, {
      silenceThreshold,
      nearSilentPct: 0.7,
    });
    const voicedPct = pitchMetrics?.voicedPct ?? 0;
    const nearSilent = silence.nearSilent && voicedPct < 0.15;

    setRecordingStats({
      durationSec,
      blobSize: blob.size,
      avgRms: silence.avgRms,
      voicedPct,
      silentPct: silence.silentPct,
      snrDb: calibrationMetrics?.snrDb,
      peak: calibrationMetrics?.peak,
      offsetMs: offsetEstimate.offsetMs,
    });

    const prepared: PreparedAttempt = {
      blob,
      durationSec,
      userBuffer,
      refContour,
      userContour,
      referenceEnvelope,
      userEnvelope,
      estimatedOffsetMs: offsetEstimate.offsetMs,
      pitchMetrics,
    };

    if (nearSilent && !forceAnalyze) {
      pendingAttemptRef.current = prepared;
      setAnalysisBlocked("We didn't detect voice. Try again closer to the mic.");
      setPhase("ready");
      if (audioContext) {
        void audioContext.close();
      }
      return null;
    }

    const results = await runAnalysisFromPrepared(prepared, forceAnalyze);
    if (audioContext) {
      void audioContext.close();
    }
    return results;
  };

  const saveAttemptSummary = async (
    overall: number,
    pitch: number,
    timing: number,
    stability: number,
    words: number,
    label: string,
    tips: string[],
    detailed?: DetailedFeedback | null
  ) => {
    if (!upload) return;
    const focusLineText = coachReport.focusLine?.text ?? null;
    const focusAreas = coachReport.topIssues ?? [];
    const attemptTips = coachReport.microDrills?.length ? coachReport.microDrills : tips;
    await fetch("/api/live-coaching/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: upload.id,
        verseIndex: selectedVerse,
        verseCount,
        scores: { overall, pitch, timing, stability, words, label },
        tips: attemptTips,
        focusLine: focusLineText,
        focusAreas,
        practiceMode,
        debug: {
          offsetMs: estimatedOffsetMs ?? undefined,
          calibration: calibrationSummary ?? undefined,
          warnings: detailed?.warnings ?? undefined,
          confidence: detailed?.confidenceLabel ?? undefined,
        },
      }),
      credentials: "include",
    }).catch(() => undefined);
    void fetchHistory(upload.id);

    const celebrationsEnabled =
      typeof window !== "undefined" &&
      window.localStorage.getItem("singbetter_celebrations_enabled") !== "0";
    if (!celebrationsEnabled || celebrationShownRef.current) return;

    if (overall >= 90) {
      celebrationShownRef.current = true;
      toast({
        title: "Great take!",
        description: `You scored ${overall}. Keep this streak going.`,
      });
    }

    try {
      const response = await fetch("/api/progress/summary", {
        credentials: "include",
      });
      if (!response.ok) return;
      const progress = (await response.json()) as { streakDays?: number };
      if ((progress.streakDays || 0) >= 3) {
        celebrationShownRef.current = true;
        toast({
          title: "Streak unlocked",
          description: `${progress.streakDays} day practice streak.`,
        });
      }
    } catch {
      // Best-effort celebration.
    }
  };

  const computeEnergyEnvelope = (buffer: AudioBuffer, start: number, end: number) => {
    const channel = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const step = Math.floor(sampleRate * 0.05);
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.min(channel.length, Math.floor(end * sampleRate));
    const envelope: number[] = [];
    for (let i = startSample; i < endSample; i += step) {
      let sum = 0;
      for (let j = i; j < Math.min(endSample, i + step); j++) {
        sum += channel[j] * channel[j];
      }
      envelope.push(Math.sqrt(sum / step));
    }
    return envelope;
  };

  const energyCorrelation = (a: number[], b: number[]) => {
    if (a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    const meanA = a.slice(0, len).reduce((acc, val) => acc + val, 0) / len;
    const meanB = b.slice(0, len).reduce((acc, val) => acc + val, 0) / len;
    let num = 0;
    let denomA = 0;
    let denomB = 0;
    for (let i = 0; i < len; i++) {
      const da = a[i] - meanA;
      const db = b[i] - meanB;
      num += da * db;
      denomA += da * da;
      denomB += db * db;
    }
    if (!denomA || !denomB) return 0;
    return Math.max(0, Math.min(1, num / Math.sqrt(denomA * denomB)));
  };

  const buildTips = ({
    pitchScore,
    timingScore,
    stabilityScore,
    label,
    refContour,
    userContour,
  }: {
    pitchScore: number;
    timingScore: number;
    stabilityScore: number;
    label: string;
    refContour: ReturnType<typeof extractPitchContour>;
    userContour: ReturnType<typeof extractPitchContour>;
  }) => {
    const tips: string[] = [];
    if (label === "Pitch Accuracy" && pitchScore < 75) {
      const avgCents = averageAbsoluteCentsDiff(refContour, userContour);
      tips.push(
        avgCents > 25
          ? "You drift off pitch on sustained notes. Slow down and lock into the target tone."
          : "Pitch accuracy needs tightening. Focus on matching the reference tone early in each line."
      );
    }
    if (label === "Tone Match" && pitchScore < 75) {
      tips.push("Your tone color is a bit off the reference. Focus on matching the resonance and dynamics.");
    }
    if (timingScore < 75) {
      tips.push("Timing is loose. Try tapping the beat and enter each phrase right on the reference cue.");
    }
    if (stabilityScore < 75) {
      tips.push("Stability could improve. Hold notes steady and control vibrato depth.");
    }
    if (tips.length === 0) {
      tips.push("Great take! Push for even smoother timing on the next pass.");
    }
    return tips;
  };

  const handleVerseCountChange = (count: number) => {
    setVerseCount(count);
    if (selectedVerse + count > verses.length) {
      setSelectedVerse(Math.max(0, verses.length - count));
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    handleUpload(file);
  };

  const guidedSteps = [
    {
      index: 1,
      title: "Upload reference track",
      done: hasAudio,
      active: !hasAudio,
    },
    {
      index: 2,
      title: "Add lyrics or transcribe",
      done: lyricsText.trim().length > 0,
      active: hasAudio && lyricsText.trim().length === 0,
    },
    {
      index: 3,
      title: "Select verse",
      done: hasVerses,
      active: hasAudio && lyricsText.trim().length > 0 && !hasVerses,
    },
    {
      index: 4,
      title: "Run mic check",
      done: calibrationReady,
      active: hasAudio && hasVerses && !calibrationReady,
    },
    {
      index: 5,
      title: "Record attempt",
      done:
        phase === "recording" ||
        phase === "stopping" ||
        phase === "uploading_attempt" ||
        phase === "analyzing_attempt" ||
        phase === "showing_feedback",
      active: calibrationReady && phase === "ready",
    },
    {
      index: 6,
      title: "Review results",
      done: phase === "showing_feedback" && !!scores,
      active: phase === "showing_feedback" && !scores,
    },
  ];

  const isBusy =
    phase === "analyzing" ||
    phase === "countdown" ||
    phase === "recording" ||
    phase === "stopping" ||
    phase === "uploading_attempt" ||
    phase === "analyzing_attempt" ||
    phase === "calibrating" ||
    phase === "priming";

  const nextAction = useMemo(() => {
    if (!hasAudio) {
      return {
        label: "Upload Reference Track",
        disabled: false,
        action: () => uploadInputRef.current?.click(),
      };
    }
    if (lyricsText.trim().length === 0) {
      if (transcribeDisabled) {
        return {
          label: "Use Manual Lyrics",
          disabled: manualLyrics.trim().length === 0,
          action: handleManualLyrics,
        };
      }
      return {
        label: quickMode ? "Transcribe (Quick)" : "Transcribe (Full)",
        disabled: phase === "analyzing",
        action: handleTranscribe,
      };
    }
    if (!hasVerses) {
      return {
        label: "Create Verses from Lyrics",
        disabled: manualLyrics.trim().length === 0,
        action: handleManualLyrics,
      };
    }
    if (!calibrationReady) {
      return {
        label: "Run Mic Check",
        disabled: !micReady || calibrationStatus === "running",
        action: handleCalibration,
      };
    }
    if (phase === "showing_feedback" && canNext) {
      return {
        label: "Next Verse",
        disabled: false,
        action: handleNext,
      };
    }
    return {
      label: "Record Attempt",
      disabled: !canRecord || isBusy,
      action: handleRecord,
    };
  }, [
    calibrationReady,
    calibrationStatus,
    canNext,
    canRecord,
    handleCalibration,
    handleManualLyrics,
    handleNext,
    handleRecord,
    handleTranscribe,
    hasAudio,
    hasVerses,
    isBusy,
    lyricsText,
    manualLyrics,
    micReady,
    phase,
    quickMode,
    transcribeDisabled,
  ]);

  return (
    <div className="min-h-screen bg-background pb-24 overflow-x-hidden">
      <audio ref={audioRef} src={audioUrl || undefined} preload="auto" />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.4em] text-muted-foreground">Live Coaching</span>
            <h1 className="text-3xl md:text-4xl font-display font-bold">Spotify-style Verse Practice</h1>
            <p className="text-muted-foreground max-w-2xl">
              Upload a reference track, follow the lyrics like karaoke, and get real-time coaching on pitch, timing, and
              stability.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Coach Mode</span>
              <button
                type="button"
                onClick={handleToggleCoachMode}
                className={`px-3 py-1 rounded-full border text-xs font-semibold transition-colors ${
                  coachMode
                    ? "bg-white/10 text-foreground border-white/20"
                    : "border-white/10 text-muted-foreground hover:text-foreground"
                }`}
              >
                {coachMode ? "On" : "Off"}
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Coach Loop</span>
              <button
                type="button"
                onClick={() => setCoachLoop((value) => !value)}
                className={`px-3 py-1 rounded-full border text-xs font-semibold transition-colors ${
                  coachLoop
                    ? "bg-white/10 text-foreground border-white/20"
                    : "border-white/10 text-muted-foreground hover:text-foreground"
                }`}
              >
                {coachLoop ? "On" : "Off"}
              </button>
            </div>
            {isDev && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Debug</span>
                <button
                  type="button"
                  onClick={() => setDebugEnabled((value) => !value)}
                  className={`px-3 py-1 rounded-full border text-xs font-semibold transition-colors ${
                    debugEnabled
                      ? "bg-white/10 text-foreground border-white/20"
                      : "border-white/10 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {debugEnabled ? "On" : "Off"}
                </button>
              </div>
            )}
          </div>
        </header>

        <section className="bg-card border border-white/5 rounded-3xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Guided Flow
              </div>
              <div className="text-sm text-muted-foreground">
                Complete each step in order for the best coaching results.
              </div>
            </div>
            <button
              type="button"
              onClick={nextAction.action}
              disabled={nextAction.disabled}
              className={`px-4 py-2 rounded-full text-sm font-semibold ${
                nextAction.disabled
                  ? "bg-white/10 text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {nextAction.label}
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {guidedSteps.map((step) => (
              <div
                key={`guided-step-${step.index}`}
                className={`rounded-2xl border px-3 py-2 text-sm ${
                  step.done
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : step.active
                    ? "border-primary/40 bg-primary/10"
                    : "border-white/10 bg-background/70"
                }`}
              >
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Step {step.index}
                </div>
                <div className="font-medium">{step.title}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid lg:grid-cols-[2fr,1fr] gap-8">
          <section className="space-y-6">
            <div className="bg-card border border-white/5 rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Reference Track</div>
                  <div className="text-lg font-semibold">{upload?.filename || "No file selected"}</div>
                  <div className="text-sm text-muted-foreground">
                    Duration {audioDuration ? `${audioDuration.toFixed(1)}s` : "--"}
                  </div>
                </div>
                <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                  <UploadCloud className="w-4 h-4" /> Upload
                  <input
                    ref={uploadInputRef}
                    id="reference-upload-input"
                    type="file"
                    className="hidden"
                    accept="audio/*"
                    aria-label="Upload reference track"
                    onChange={handleFileChange}
                  />
                </label>
              </div>
            </div>

            {hasAudio && (
              <div className="bg-card border border-white/5 rounded-3xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Transcribe Lyrics</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQuickMode(true)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        quickMode
                          ? "bg-white/10 text-foreground border-white/20"
                          : "border-white/10 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Quick (60s)
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickMode(false)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        !quickMode
                          ? "bg-white/10 text-foreground border-white/20"
                          : "border-white/10 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Full
                    </button>
                    <button
                      type="button"
                      onClick={handleTranscribe}
                      disabled={transcribeDisabled || phase === "analyzing"}
                      className={`px-4 py-2 rounded-full text-sm font-semibold ${
                        transcribeDisabled || phase === "analyzing"
                          ? "bg-white/10 text-muted-foreground cursor-not-allowed"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      {transcribeDisabled ? "Disabled" : "Analyze"}
                    </button>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  Quick mode is faster and uses the first 60 seconds. Use Full for complete lyrics.
                </div>
                {transcribeDisabled && (
                  <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                    Transcription is disabled due to quota limits. Paste lyrics manually to continue.
                  </div>
                )}
                <textarea
                  value={manualLyrics}
                  onChange={(event) => setManualLyrics(event.target.value)}
                  rows={5}
                  className="w-full rounded-2xl border border-white/10 bg-background p-4 text-sm text-foreground"
                  placeholder="Paste lyrics with blank lines separating verses..."
                />
                <button
                  type="button"
                  onClick={handleManualLyrics}
                  className="px-4 py-2 rounded-full bg-white/10 text-sm font-semibold"
                >
                  Use Manual Lyrics
                </button>
              </div>
            )}

            {phase === "analyzing" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {quickMode ? "Analyzing audio (quick)..." : "Analyzing audio (full)..."}
              </div>
            )}

            {hasAudio && (
              <div className="bg-card border border-white/5 rounded-3xl p-6 space-y-6">
                {hasVerses ? (
                  <VerseSelector
                    verses={verses}
                    selectedIndex={selectedVerse}
                    verseCount={verseCount}
                    onSelect={setSelectedVerse}
                    onCountChange={handleVerseCountChange}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                    <div className="text-xs uppercase tracking-widest mb-2 text-muted-foreground">
                      No Verses Yet
                    </div>
                    Paste lyrics above or run transcription to enable verse selection. You can still
                    record with the full track.
                  </div>
                )}

                {hasVerses ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-widest text-muted-foreground">Lyrics Preview</div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setLyricsSize("compact")}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                            lyricsSize === "compact"
                              ? "bg-white/10 text-foreground border-white/20"
                              : "border-white/10 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Compact
                        </button>
                        <button
                          type="button"
                          onClick={() => setLyricsSize("large")}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                            lyricsSize === "large"
                              ? "bg-white/10 text-foreground border-white/20"
                              : "border-white/10 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Large
                        </button>
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-background p-4">
                      <KaraokeLyrics
                        lines={activeSegment.lines}
                        currentTime={currentTime}
                        size={lyricsSize}
                        align="left"
                        windowed={false}
                        wordFeedback={wordFeedbackMap}
                        focusLineIndex={karaokeFocusLineIndex}
                        liveCurrentWordIndex={liveCurrentWordIndex}
                        isRecording={isRecording}
                        activeHighlight={karaokeActiveHighlight}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Recording will use the full track until lyrics are added.
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex justify-between text-xs uppercase tracking-widest text-muted-foreground">
                    <span>Progress</span>
                    <span>
                      {segmentDuration
                        ? `${Math.max(0, currentTime - activeSegment.start).toFixed(1)}s`
                        : "0.0s"}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-secondary"
                      style={{
                        width: segmentDuration
                          ? `${Math.min(100, ((currentTime - activeSegment.start) / segmentDuration) * 100)}%`
                          : "0%",
                      }}
                    />
                  </div>
                </div>

                {micError && (
                  <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                    {micError}
                  </div>
                )}

                {analysisError && (
                  <div className="text-sm text-red-200 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                    {analysisError}
                  </div>
                )}

                {analysisBlocked && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 space-y-2 text-sm text-amber-100">
                    <div>{analysisBlocked}</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="px-3 py-1 rounded-full bg-white/10 text-xs font-semibold"
                      >
                        Re-record
                      </button>
                      <button
                        type="button"
                        onClick={handleAnalyzeAnyway}
                        className="px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold"
                      >
                        Analyze anyway
                      </button>
                    </div>
                  </div>
                )}

                <RecordingPanel
                  phase={phase}
                  countdown={countdown}
                  recordingTime={recordingTime}
                  inputLevel={inputLevel}
                  liveCoach={liveCoachMetrics}
                  liveUpdateHz={liveUpdateHz}
                  showDebug={debugEnabled}
                  onStartPractice={handleRecord}
                  onStop={handleStop}
                  onRetry={handleRetry}
                  onPlayReference={handlePlayReference}
                  onEnableMic={handleEnableMic}
                  onCalibrate={handleCalibration}
                  onOverrideCalibration={handleOverrideCalibration}
                  onResetCalibration={resetCalibration}
                  calibrationStatus={calibrationStatus}
                  calibrationMetrics={calibrationMetrics}
                  calibrationIssues={calibrationIssues}
                  calibrationGuidance={calibrationGuidance}
                  calibrationOverride={calibrationOverride}
                  practiceMode={practiceMode}
                  onPracticeModeChange={setPracticeMode}
                  canRecord={canRecord}
                  onNext={handleNext}
                  onPrev={handlePrev}
                  canNext={canNext}
                  canPrev={canPrev}
                  micReady={micReady}
                  disabled={!hasAudio}
                />
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <CoachPanel
              phase={phase}
              meters={meters}
              scores={scores}
              scoreBreakdown={scoreBreakdown}
              coachPriority={coachPriority}
              coachReport={coachReport}
              drillPlan={drillPlan}
              coachCards={coachCards}
              coachMode={coachMode}
              drillSession={drillSession}
              drillDelta={drillDelta}
              drillTargetLine={drillTargetLine?.text}
              drillTargetLineIndex={drillTargetLine?.index}
              onRetryDrill={handleRetry}
              onSkipDrill={handleSkipDrill}
              onNextLine={handleNext}
              onPlayReference={handlePlayReference}
              history={history}
            />

            {isDev && debugEnabled && (
              <div className="bg-card border border-white/5 rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Debug</div>
                  <button
                    type="button"
                    onClick={() => setDebugOpen((value) => !value)}
                    className="px-3 py-1 rounded-full border border-white/10 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  >
                    {debugOpen ? "Hide" : "Show"}
                  </button>
                </div>

                {debugOpen && (
                  <div className="space-y-4 text-xs text-muted-foreground">
                    <div className="grid grid-cols-2 gap-3">
                      <div>voicedPct: {(debugMetrics.voicedPct * 100).toFixed(1)}%</div>
                      <div>biasCents: {debugMetrics.biasCents}</div>
                      <div>medianAbsErrorCents: {debugMetrics.medianAbsErrorCents}</div>
                      <div>noteAccuracyScore: {debugMetrics.noteAccuracyScore}</div>
                      <div>dictionClarityScore: {debugMetrics.dictionClarityScore}</div>
                      <div>phrasingScore: {debugMetrics.phrasingScore}</div>
                      <div>timingMeanAbsMs: {debugMetrics.timingMeanAbsMs}</div>
                      <div>wordAccuracyPct: {debugMetrics.wordAccuracyPct}</div>
                      <div>paceRatio: {debugMetrics.paceRatio.toFixed(2)}</div>
                      <div>coveragePct: {(debugMetrics.coveragePct * 100).toFixed(1)}%</div>
                      <div>estimatedOffsetMs: {debugMetrics.estimatedOffsetMs}</div>
                      <div>pitchAnalyzing: {pitchAnalyzing ? "yes" : "no"}</div>
                      <div>sessionId: {sessionIdRef.current}</div>
                      <div>coachLoop: {coachLoop ? "on" : "off"}</div>
                      {autoLoopNote && <div>autoLoop: {autoLoopNote}</div>}
                      {recordingStats && (
                        <>
                          <div>recordingDur: {recordingStats.durationSec.toFixed(2)}s</div>
                          <div>blobSize: {Math.round(recordingStats.blobSize / 1024)}kb</div>
                          <div>avgRms: {recordingStats.avgRms.toFixed(3)}</div>
                          <div>voicedPct: {recordingStats.voicedPct?.toFixed(2) ?? "--"}</div>
                          <div>silentPct: {recordingStats.silentPct?.toFixed(2) ?? "--"}</div>
                          <div>snrDb: {recordingStats.snrDb?.toFixed(1) ?? "--"}</div>
                          <div>offsetMs: {recordingStats.offsetMs ?? "--"}</div>
                        </>
                      )}
                      {analysisError && <div>analysisError: {analysisError}</div>}
                      {liveCoachMetrics && (
                        <>
                          <div>livePitch: {liveCoachMetrics.pitchLabel}</div>
                          <div>liveTiming: {liveCoachMetrics.timingLabel}</div>
                          <div>liveEnergy: {liveCoachMetrics.energyLabel ?? "--"}</div>
                          <div>liveClarity: {liveCoachMetrics.clarityLabel ?? "--"}</div>
                          <div>liveRms: {liveCoachMetrics.rms.toFixed(3)}</div>
                          <div>liveF0: {liveCoachMetrics.f0Hz ? liveCoachMetrics.f0Hz.toFixed(1) : "--"}</div>
                          <div>liveCents: {liveCoachMetrics.centsError?.toFixed(1) ?? "--"}</div>
                          <div>liveHz: {liveUpdateHz.toFixed(1)}</div>
                          <div>tNow: {liveCoachMetrics.t.toFixed(2)}</div>
                          <div>micLatencyMs: {liveCoachMetrics.micLatencyMs ?? 0}</div>
                          <div>expectedWordIndex: {liveCoachMetrics.expectedWordIndexNow ?? "--"}</div>
                          <div>expectedWord: {liveCoachMetrics.expectedWordText ?? "--"}</div>
                          <div>expectedWordStart: {liveCoachMetrics.expectedWordStart?.toFixed(2) ?? "--"}</div>
                          <div>deltaToExpectedMs: {liveCoachMetrics.deltaToExpectedMs ?? "--"}</div>
                        </>
                      )}
                      {micError && <div>micError: {micError}</div>}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-widest text-muted-foreground">
                        Worst Deltas
                      </div>
                      <div className="max-h-40 overflow-auto rounded-xl border border-white/10">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-white/5 text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1">Word</th>
                              <th className="px-2 py-1">Delta ms</th>
                              <th className="px-2 py-1">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {worstDeltas.map((word) => (
                              <tr key={`delta-${word.refIndex}`}>
                                <td className="px-2 py-1">{word.refWord}</td>
                                <td className="px-2 py-1">{word.deltaMs}</td>
                                <td className="px-2 py-1">{word.status}</td>
                              </tr>
                            ))}
                            {worstDeltas.length === 0 && (
                              <tr>
                                <td className="px-2 py-2 text-muted-foreground" colSpan={3}>
                                  No alignment data yet.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {liveEvents.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">
                          Live Events
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {liveEvents.map((event, idx) => (
                            <span
                              key={`live-event-${idx}`}
                              className="text-[10px] rounded-full border border-white/10 px-2 py-0.5 text-muted-foreground"
                            >
                              {event}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleCopyAnalysis}
                      className="px-3 py-2 rounded-full bg-white/10 text-xs font-semibold"
                    >
                      Copy analysis JSON
                    </button>
                  </div>
                )}
              </div>
            )}

            {detailed && (
              <div className="bg-card border border-white/5 rounded-3xl p-6 space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Detailed Feedback
                  </div>
                  <div className="text-lg font-semibold">Verse Breakdown</div>
                </div>

                {detailed.message && (
                  <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                    {detailed.message}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">Word Accuracy</div>
                    <div className="text-xl font-bold">{detailed.subscores.wordAccuracy}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">Timing</div>
                    <div className="text-xl font-bold">{detailed.subscores.timing}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">Pace</div>
                    <div className="text-xl font-bold">{detailed.subscores.pace}</div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Accuracy {detailed.wordAccuracyPct}% - Timing {detailed.timingMeanAbsMs}ms - Pace{" "}
                  {detailed.paceRatio.toFixed(2)}x
                </div>

                {improvement && (
                  <div className="text-xs text-muted-foreground">
                    Improvement: {improvement.accuracyDelta >= 0 ? "+" : ""}
                    {improvement.accuracyDelta}% accuracy, {improvement.timingDelta >= 0 ? "-" : "+"}
                    {Math.abs(improvement.timingDelta)}ms timing error, {improvement.paceDelta >= 0 ? "+" : ""}
                    {improvement.paceDelta} pace ratio
                  </div>
                )}

                {(detailed.missedWords.length > 0 ||
                  detailed.extraWords.length > 0 ||
                  (detailed.substitutions?.length ?? 0) > 0) && (
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      Alignment
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Confidence: {detailed.confidenceLabel ?? "--"}
                    </div>
                    {detailed.missedWords.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Missed words: {detailed.missedWords.slice(0, 6).join(", ")}
                      </div>
                    )}
                    {(detailed.substitutions?.length ?? 0) > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Substitutions:{" "}
                        {detailed.substitutions
                          ?.slice(0, 4)
                          .map(
                            (sub) =>
                              `${sub.refWord}->${sub.userWord}${
                                sub.confidenceLabel ? ` (${sub.confidenceLabel})` : ""
                              }`
                          )
                          .join(", ")}
                      </div>
                    )}
                    {detailed.extraWords.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Extra words: {detailed.extraWords.slice(0, 6).join(", ")}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Line-by-line</div>
                  {detailed.segments.slice(0, 6).map((segment) => (
                    <div
                      key={`segment-${segment.segmentIndex}`}
                      className="rounded-2xl border border-white/10 bg-background/70 px-3 py-2 space-y-1"
                    >
                      <div className="text-sm font-semibold">{segment.text}</div>
                      <div className="text-xs text-muted-foreground">
                        Accuracy {segment.wordAccuracyPct}% - Timing {segment.timingMeanAbsMs}ms
                      </div>
                      <ul className="text-xs text-muted-foreground">
                        {segment.mainIssues.map((issue, index) => (
                          <li key={`issue-${segment.segmentIndex}-${index}`}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>


              </div>
            )}

            {phase === "showing_feedback" && !coachMode && (
              <div className="bg-card border border-white/5 rounded-3xl p-6 space-y-3">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Next Action</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold"
                  >
                    Retry same line
                  </button>
                  {canNext && (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="px-4 py-2 rounded-full bg-white/10 text-sm font-semibold"
                    >
                      Next line
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePlayReference}
                    className="px-4 py-2 rounded-full bg-white/10 text-sm font-semibold"
                  >
                    Listen reference
                  </button>
                </div>
              </div>
            )}

            {phase === "showing_feedback" && scores && scores.overall < SCORE_THRESHOLD && (
              <div className="bg-card border border-white/5 rounded-3xl p-6 text-sm text-muted-foreground">
                Auto retry enabled (target {SCORE_THRESHOLD}). Use Retry or Next to override.
              </div>
            )}
          </aside>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
