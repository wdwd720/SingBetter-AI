import { detectPitch } from "./pitch";

export type LiveCoachMetrics = {
  t: number;
  rms: number;
  voiced: boolean;
  f0Hz: number | null;
  centsError?: number | null;
  pitchLabel: "on" | "flat" | "sharp" | "unvoiced";
  timingLabel: "ahead" | "behind" | "on";
  paceRatio: number;
  stability: number;
  liveTip?: string;
  energyLabel?: "quiet" | "good" | "loud";
  clarityLabel?: "unclear" | "clear-ish";
  expectedWordIndexNow?: number | null;
  expectedWordText?: string | null;
  expectedWordStart?: number | null;
  expectedLineIndexNow?: number | null;
  expectedLineStart?: number | null;
  deltaToExpectedMs?: number | null;
  micLatencyMs?: number;
};

type ReferenceWord = {
  start: number;
  end: number;
  word?: string;
  refIndex?: number;
};

type ReferenceInput = {
  words?: ReferenceWord[];
  lines?: Array<{ start: number; end: number; index?: number; text?: string }>;
  durationSec?: number;
  medianF0Hz?: number;
};

type LiveCoachOptions = {
  updateHz?: number;
};

type LiveCoachController = {
  stop: () => void;
  onUpdate: (cb: (metrics: LiveCoachMetrics) => void) => () => void;
};

const RMS_VOICED = 0.012;
const RMS_QUIET = 0.018;
const RMS_LOUD = 0.12;
const ONSET_DELTA = 0.01;
const ONSET_MIN_GAP = 0.15;
const TIMING_THRESHOLD = 0.25;
const TIP_DEBOUNCE_MS = 500;
const LATENCY_CLAMP_MS = 250;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const computeRms = (buffer: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
};

const computeZcr = (buffer: Float32Array) => {
  let crossings = 0;
  for (let i = 1; i < buffer.length; i++) {
    if ((buffer[i - 1] >= 0 && buffer[i] < 0) || (buffer[i - 1] < 0 && buffer[i] >= 0)) {
      crossings += 1;
    }
  }
  return crossings / Math.max(1, buffer.length - 1);
};

const centsFromHz = (target: number, actual: number) =>
  1200 * Math.log2(actual / target);

const mean = (values: number[]) =>
  values.length ? values.reduce((acc, v) => acc + v, 0) / values.length : 0;

const stddev = (values: number[]) => {
  if (!values.length) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
};

const findNearestStart = (starts: number[], t: number) => {
  if (!starts.length) return null;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (starts[mid] < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const idx = lo;
  if (idx === 0) return { index: 0, start: starts[0] };
  const prev = starts[idx - 1];
  const next = starts[idx];
  if (Math.abs(t - prev) <= Math.abs(t - next)) {
    return { index: idx - 1, start: prev };
  }
  return { index: idx, start: next };
};

const findExpectedWindow = <T extends { start: number; end: number }>(items: T[], t: number) => {
  if (!items.length) return null;
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (items[mid].start < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const idx = lo;
  if (idx === 0) return items[0];
  if (idx >= items.length) return items[items.length - 1];
  const prev = items[idx - 1];
  const next = items[idx];
  if (t <= prev.end) return prev;
  return next;
};

export function startLiveCoach(
  stream: MediaStream,
  reference: ReferenceInput,
  options: LiveCoachOptions = {}
): LiveCoachController {
  const listeners = new Set<(metrics: LiveCoachMetrics) => void>();
  const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
  const updateHz = options.updateHz ?? 15;
  const updateInterval = 1000 / updateHz;
  const referenceWords = (reference.words ?? [])
    .map((word, idx) => ({
      ...word,
      refIndex: typeof word.refIndex === "number" ? word.refIndex : idx,
    }))
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
    .sort((a, b) => a.start - b.start);
  const referenceStarts = referenceWords.map((word) => word.start);
  const referenceLines = (reference.lines ?? [])
    .filter((line) => Number.isFinite(line.start) && Number.isFinite(line.end))
    .sort((a, b) => a.start - b.start);
  const targetF0 = reference.medianF0Hz && reference.medianF0Hz > 0 ? reference.medianF0Hz : null;

  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let rafId: number | null = null;
  let stopped = false;
  let lastUpdate = 0;
  let lastRms = 0;
  let smoothRms = 0;
  let lastOnset = 0;
  let lastTip = "Keep it steady.";
  let pendingTip = "";
  let pendingSince = 0;
  const recentCents: Array<{ t: number; cents: number }> = [];
  const onsetOffsets: Array<{ t: number; offset: number }> = [];
  let micLatencyMs = 0;
  let latencyLocked = false;

  const stop = () => {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (source) source.disconnect();
    if (analyser) analyser.disconnect();
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    audioContext = null;
    analyser = null;
    source = null;
    listeners.clear();
  };

  const onUpdate = (cb: (metrics: LiveCoachMetrics) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };

  if (!AudioContextClass) {
    return { stop, onUpdate };
  }

  const context = new AudioContextClass();
  const localAnalyser = context.createAnalyser();
  const localSource = context.createMediaStreamSource(stream);
  audioContext = context;
  analyser = localAnalyser;
  source = localSource;
  localAnalyser.fftSize = 2048;
  localAnalyser.smoothingTimeConstant = 0;
  localSource.connect(localAnalyser);
  const buffer = new Float32Array(localAnalyser.fftSize);
  const startTime = context.currentTime;

  const updateTip = (nextTip: string, now: number) => {
    if (nextTip === lastTip) {
      pendingTip = "";
      return lastTip;
    }
    if (pendingTip !== nextTip) {
      pendingTip = nextTip;
      pendingSince = now;
      return lastTip;
    }
    if (now - pendingSince >= TIP_DEBOUNCE_MS) {
      lastTip = nextTip;
      pendingTip = "";
    }
    return lastTip;
  };

  const tick = (now: number) => {
    if (stopped) return;
    const context = audioContext;
    const localAnalyser = analyser;
    if (!localAnalyser || !context) return;
    rafId = requestAnimationFrame(tick);

    if (now - lastUpdate < updateInterval) return;
    lastUpdate = now;

    localAnalyser.getFloatTimeDomainData(buffer);
    const rawRms = computeRms(buffer);
    smoothRms = smoothRms * 0.82 + rawRms * 0.18;
    const rms = smoothRms;
    const zcr = computeZcr(buffer);
    const pitch = rms > RMS_VOICED ? detectPitch(buffer, context.sampleRate) : 0;
    const voiced = pitch > 0;
    const rawTimeSec = context.currentTime - startTime;
    if (rawTimeSec < 0) return;
    let timeSec = rawTimeSec - micLatencyMs / 1000;
    if (timeSec < 0) timeSec = 0;

    let centsError: number | null = null;
    if (voiced && targetF0) {
      centsError = centsFromHz(targetF0, pitch);
      recentCents.push({ t: timeSec, cents: centsError });
    }

    const stabilityWindow = 1.4;
    while (recentCents.length && timeSec - recentCents[0].t > stabilityWindow) {
      recentCents.shift();
    }
    const stabilityCents = stddev(recentCents.map((entry) => entry.cents));
    const stability = clamp(Math.round(100 - stabilityCents * 1.2), 0, 100);

    let pitchLabel: LiveCoachMetrics["pitchLabel"] = "unvoiced";
    if (voiced && centsError !== null) {
      if (centsError < -30) pitchLabel = "flat";
      else if (centsError > 30) pitchLabel = "sharp";
      else pitchLabel = "on";
    } else if (voiced) {
      pitchLabel = "on";
    }

    const energyLabel: LiveCoachMetrics["energyLabel"] =
      rms < RMS_QUIET ? "quiet" : rms > RMS_LOUD ? "loud" : "good";
    const clarityLabel: LiveCoachMetrics["clarityLabel"] =
      rms > RMS_QUIET && zcr > 0.05 ? "clear-ish" : "unclear";

    const isOnset = rms - lastRms > ONSET_DELTA && rms > RMS_QUIET;
    if (isOnset && timeSec - lastOnset > ONSET_MIN_GAP) {
      lastOnset = timeSec;
      const expected = findExpectedWindow(referenceWords, timeSec);
      if (!latencyLocked && referenceWords.length && expected?.start !== undefined) {
        const firstStart = referenceWords[0]?.start ?? 0;
        if (firstStart <= 1.5) {
          const rawLatency = (rawTimeSec - firstStart) * 1000;
          if (Math.abs(rawLatency) <= LATENCY_CLAMP_MS) {
            micLatencyMs = clamp(rawLatency, -LATENCY_CLAMP_MS, LATENCY_CLAMP_MS);
            latencyLocked = true;
          }
        }
      }
      if (expected) {
        onsetOffsets.push({ t: timeSec, offset: timeSec - expected.start });
      }
    }
    lastRms = rms;

    while (onsetOffsets.length && timeSec - onsetOffsets[0].t > 2.5) {
      onsetOffsets.shift();
    }
    const avgOffset = mean(onsetOffsets.map((entry) => entry.offset));
    let timingLabel: LiveCoachMetrics["timingLabel"] = "on";
    if (avgOffset < -TIMING_THRESHOLD) timingLabel = "ahead";
    if (avgOffset > TIMING_THRESHOLD) timingLabel = "behind";

    let paceRatio = 1;
    if (onsetOffsets.length > 0) {
      const last = onsetOffsets[onsetOffsets.length - 1];
      const nearest = findNearestStart(referenceStarts, last.t);
      if (nearest && nearest.start > 0.2) {
        paceRatio = clamp(last.t / nearest.start, 0.6, 1.6);
      }
    }

    const expectedWord = findExpectedWindow(referenceWords, timeSec);
    const expectedLine = findExpectedWindow(referenceLines, timeSec);
    const deltaToExpectedMs =
      expectedWord ? Math.round((timeSec - expectedWord.start) * 1000) : null;

    const liveTipCandidate = (() => {
      if (!voiced) return "We can’t detect pitch — sing a bit louder and closer.";
      if (energyLabel === "quiet") return "Too quiet — project more on word starts.";
      if (energyLabel === "loud") return "Too loud — back off slightly for control.";
      if (pitchLabel === "flat") return "You’re drifting flat — raise pitch slightly.";
      if (pitchLabel === "sharp") return "You’re sharp — relax and aim a touch lower.";
      if (timingLabel === "ahead") return "You’re rushing — enter with the cue.";
      if (timingLabel === "behind") return "You’re late — push forward to the beat.";
      if (stability < 60) return "Pitch wobbly — steady the sustain.";
      if (clarityLabel === "unclear") return "Articulation is unclear — lean into consonants.";
      return "Nice — keep it steady.";
    })();

    const liveTip = updateTip(liveTipCandidate, now);

    const metrics: LiveCoachMetrics = {
      t: timeSec,
      rms: clamp(rms, 0, 1),
      voiced,
      f0Hz: voiced ? pitch : null,
      centsError: centsError ?? null,
      pitchLabel,
      timingLabel,
      paceRatio,
      stability,
      liveTip,
      energyLabel,
      clarityLabel,
      expectedWordIndexNow: expectedWord?.refIndex ?? null,
      expectedWordText: expectedWord?.word ?? null,
      expectedWordStart: expectedWord?.start ?? null,
      expectedLineIndexNow:
        expectedLine && typeof expectedLine.index === "number" ? expectedLine.index : null,
      expectedLineStart: expectedLine?.start ?? null,
      deltaToExpectedMs,
      micLatencyMs,
    };

    listeners.forEach((cb) => cb(metrics));
  };

  const start = async () => {
    if (!audioContext) return;
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => undefined);
    }
    rafId = requestAnimationFrame(tick);
  };
  void start();

  return { stop, onUpdate };
}
