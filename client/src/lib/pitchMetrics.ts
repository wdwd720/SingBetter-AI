import { detectPitch } from "./pitch";

export type PitchFrame = {
  t: number;
  f0Hz: number | null;
  voiced: boolean;
  rms?: number;
};

export type PitchContour = {
  frames: PitchFrame[];
  sampleRate: number;
  hopSec: number;
};

export type PitchMetrics = {
  voicedPct: number;
  medianF0Hz: number;
  centsStdDev: number;
  centsIQR: number;
  driftCentsPerSec: number;
  vibratoRateHz: number;
  jitterCentsRms: number;
  stabilityScore: number;
  lowConfidence: boolean;
};

const RMS_FLOOR = 0.008;

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const stddev = (values: number[]) => {
  if (!values.length) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
};

const linearSlope = (xs: number[], ys: number[]) => {
  if (!xs.length || xs.length !== ys.length) return 0;
  const meanX = xs.reduce((acc, v) => acc + v, 0) / xs.length;
  const meanY = ys.reduce((acc, v) => acc + v, 0) / ys.length;
  let num = 0;
  let denom = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    denom += dx * dx;
  }
  return denom === 0 ? 0 : num / denom;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const value = buffer[i];
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

export function extractPitchContourFromBuffer(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  hopSec = 0.02,
  frameSec = 0.04
): PitchContour {
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(channel.length, Math.floor(endSec * sampleRate));
  const frameSize = Math.max(1024, Math.round(frameSec * sampleRate));
  const hopSamples = Math.max(1, Math.floor(hopSec * sampleRate));

  const frames: PitchFrame[] = [];
  for (let i = startSample; i + frameSize <= endSample; i += hopSamples) {
    const slice = channel.subarray(i, i + frameSize);
    const rms = computeRms(slice);
    const pitch = rms > RMS_FLOOR ? detectPitch(slice, sampleRate) : 0;
    const voiced = pitch > 0;
    frames.push({
      t: (i - startSample) / sampleRate,
      f0Hz: voiced ? pitch : null,
      voiced,
      rms,
    });
  }

  return { frames, sampleRate, hopSec };
}

export async function extractPitchContourFromBlob(
  blob: Blob,
  hopSec = 0.02
): Promise<{ contour: PitchContour; metrics: PitchMetrics }> {
  const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => undefined);
  }
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const contour = extractPitchContourFromBuffer(audioBuffer, 0, audioBuffer.duration, hopSec);
  const metrics = computePitchMetrics(contour);
  await audioContext.close().catch(() => undefined);
  return { contour, metrics };
}

export function computePitchMetrics(contour: PitchContour): PitchMetrics {
  const voicedFrames = contour.frames.filter((frame) => frame.voiced && frame.f0Hz);
  const voicedPct = contour.frames.length ? voicedFrames.length / contour.frames.length : 0;
  const f0Values = voicedFrames.map((frame) => frame.f0Hz ?? 0).filter((v) => v > 0);
  const medianF0Hz = median(f0Values);
  const cents = medianF0Hz
    ? f0Values.map((f0, idx) => 1200 * Math.log2(f0 / medianF0Hz))
    : [];
  const centsStdDev = stddev(cents);
  const sorted = [...cents].sort((a, b) => a - b);
  const q1 = sorted.length ? sorted[Math.floor(sorted.length * 0.25)] : 0;
  const q3 = sorted.length ? sorted[Math.floor(sorted.length * 0.75)] : 0;
  const centsIQR = q3 - q1;

  const times = voicedFrames.map((frame) => frame.t);
  const driftCentsPerSec = cents.length ? linearSlope(times, cents) : 0;

  let jitterCentsRms = 0;
  if (cents.length > 1) {
    const diffs = cents.slice(1).map((value, idx) => value - cents[idx]);
    jitterCentsRms = stddev(diffs);
  }

  let vibratoRateHz = 0;
  if (cents.length > 8) {
    const mean = cents.reduce((acc, v) => acc + v, 0) / cents.length;
    const centered = cents.map((v) => v - mean);
    const minLag = Math.max(1, Math.floor(1 / (9 * contour.hopSec)));
    const maxLag = Math.max(minLag + 1, Math.floor(1 / (3 * contour.hopSec)));
    let bestLag = 0;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < centered.length; i++) {
        sum += centered[i] * centered[i + lag];
      }
      if (sum > bestCorr) {
        bestCorr = sum;
        bestLag = lag;
      }
    }
    if (bestLag > 0 && bestCorr > 0) {
      vibratoRateHz = 1 / (bestLag * contour.hopSec);
    }
  }

  const stabilityScore = clamp(
    Math.round(100 - centsStdDev * 0.9 - jitterCentsRms * 0.6 - Math.abs(driftCentsPerSec) * 2.5),
    0,
    100
  );

  return {
    voicedPct,
    medianF0Hz,
    centsStdDev,
    centsIQR,
    driftCentsPerSec,
    vibratoRateHz,
    jitterCentsRms,
    stabilityScore,
    lowConfidence: voicedPct < 0.25,
  };
}
