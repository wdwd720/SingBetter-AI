export type CalibrationMetrics = {
  rmsAvg: number;
  peak: number;
  noiseFloor: number;
  snrDb: number;
  clippingPct: number;
  sampleSec: number;
};

export type CalibrationEvaluation = {
  pass: boolean;
  issues: string[];
  guidance: string[];
};

export type SilenceAnalysis = {
  avgRms: number;
  peak: number;
  silentPct: number;
  nearSilent: boolean;
};

type AudioStatsAccumulator = {
  push: (buffer: Float32Array) => void;
  finalize: (durationSec?: number) => CalibrationMetrics;
};

const CLIP_THRESHOLD = 0.98;
const QUIET_RMS = 0.012;
const MAX_PEAK = 0.98;
const MAX_CLIP_PCT = 0.02;
const MAX_NOISE_FLOOR = 0.02;
const MIN_SNR_DB = 10;

const computeRms = (buffer: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = buffer[i];
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
};

const computePeak = (buffer: Float32Array) => {
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.abs(buffer[i]);
    if (value > peak) peak = value;
  }
  return peak;
};

const percentile = (values: number[], pct: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(pct * (sorted.length - 1))));
  return sorted[idx];
};

export function createAudioStatsAccumulator(): AudioStatsAccumulator {
  const rmsValues: number[] = [];
  let sampleCount = 0;
  let clipCount = 0;
  let peak = 0;
  let rmsSum = 0;

  return {
    push(buffer: Float32Array) {
      if (!buffer || buffer.length === 0) return;
      const rms = computeRms(buffer);
      rmsValues.push(rms);
      rmsSum += rms;

      const framePeak = computePeak(buffer);
      if (framePeak > peak) peak = framePeak;

      for (let i = 0; i < buffer.length; i += 1) {
        if (Math.abs(buffer[i]) >= CLIP_THRESHOLD) clipCount += 1;
      }
      sampleCount += buffer.length;
    },
    finalize(durationSec = 0) {
      const rmsAvg = rmsValues.length ? rmsSum / rmsValues.length : 0;
      const noiseFloor = percentile(rmsValues, 0.1);
      const clippingPct = sampleCount > 0 ? clipCount / sampleCount : 0;
      const snrDb =
        noiseFloor > 0
          ? 20 * Math.log10(Math.max(1e-6, rmsAvg) / Math.max(1e-6, noiseFloor))
          : 60;
      return {
        rmsAvg,
        peak,
        noiseFloor,
        snrDb,
        clippingPct,
        sampleSec: durationSec,
      };
    },
  };
}

export function evaluateCalibration(metrics: CalibrationMetrics): CalibrationEvaluation {
  const issues: string[] = [];
  const guidance: string[] = [];

  if (metrics.rmsAvg < QUIET_RMS) {
    issues.push("Input too quiet.");
    guidance.push("Move closer to the mic or increase input gain.");
  }
  if (metrics.peak >= MAX_PEAK || metrics.clippingPct > MAX_CLIP_PCT) {
    issues.push("Clipping detected.");
    guidance.push("Lower input gain or back away from the mic.");
  }
  if (metrics.noiseFloor > MAX_NOISE_FLOOR) {
    issues.push("Background noise is high.");
    guidance.push("Try a quieter room or reduce ambient noise.");
  }
  if (metrics.snrDb < MIN_SNR_DB) {
    issues.push("Low signal-to-noise ratio.");
    guidance.push("Project louder or reduce noise.");
  }

  return {
    pass: issues.length === 0,
    issues,
    guidance,
  };
}

export function analyzeSilence(
  envelope: number[],
  options?: { silenceThreshold?: number; nearSilentPct?: number }
): SilenceAnalysis {
  if (!envelope.length) {
    return { avgRms: 0, peak: 0, silentPct: 1, nearSilent: true };
  }
  const silenceThreshold = options?.silenceThreshold ?? QUIET_RMS;
  const nearSilentPct = options?.nearSilentPct ?? 0.7;
  let silentCount = 0;
  let sum = 0;
  let peak = 0;
  for (const value of envelope) {
    sum += value;
    if (value > peak) peak = value;
    if (value <= silenceThreshold) silentCount += 1;
  }
  const avgRms = sum / envelope.length;
  const silentPct = silentCount / envelope.length;
  return {
    avgRms,
    peak,
    silentPct,
    nearSilent: silentPct >= nearSilentPct,
  };
}

export function summarizeCalibration(metrics?: CalibrationMetrics | null) {
  if (!metrics) return undefined;
  return `rms ${metrics.rmsAvg.toFixed(3)}, peak ${metrics.peak.toFixed(2)}, snr ${metrics.snrDb.toFixed(
    1
  )}dB, noise ${metrics.noiseFloor.toFixed(3)}, clip ${(metrics.clippingPct * 100).toFixed(1)}%`;
}
