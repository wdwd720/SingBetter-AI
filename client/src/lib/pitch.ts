export type PitchSample = {
  time: number;
  frequency: number;
};

export function detectPitch(buffer: Float32Array, sampleRate: number): number {
  const size = buffer.length;
  let rms = 0;
  for (let i = 0; i < size; i++) {
    const value = buffer[i];
    rms += value * value;
  }
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return 0;

  let r1 = 0;
  let r2 = size - 1;
  const threshold = 0.2;
  for (let i = 0; i < size / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < size / 2; i++) {
    if (Math.abs(buffer[size - i]) < threshold) {
      r2 = size - i;
      break;
    }
  }

  const trimmed = buffer.slice(r1, r2);
  const trimmedSize = trimmed.length;
  const corr = new Array<number>(trimmedSize).fill(0);

  for (let lag = 0; lag < trimmedSize; lag++) {
    let sum = 0;
    for (let i = 0; i < trimmedSize - lag; i++) {
      sum += trimmed[i] * trimmed[i + lag];
    }
    corr[lag] = sum;
  }

  let d = 0;
  while (d < corr.length - 1 && corr[d] > corr[d + 1]) d++;

  let maxPos = -1;
  let maxVal = -1;
  for (let i = d; i < corr.length; i++) {
    if (corr[i] > maxVal) {
      maxVal = corr[i];
      maxPos = i;
    }
  }

  if (maxPos <= 0) return 0;

  const x1 = corr[maxPos - 1] ?? 0;
  const x2 = corr[maxPos];
  const x3 = corr[maxPos + 1] ?? 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const refined = a ? maxPos - b / (2 * a) : maxPos;

  return refined > 0 ? sampleRate / refined : 0;
}

export function centsOff(reference: number, actual: number): number {
  if (reference <= 0 || actual <= 0) return 0;
  return 1200 * Math.log2(actual / reference);
}

export function extractPitchContour(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  stepSec = 0.05
): PitchSample[] {
  const samples: PitchSample[] = [];
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;

  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(channel.length, Math.floor(endSec * sampleRate));
  const windowSize = Math.floor(stepSec * sampleRate);

  for (let i = startSample; i + windowSize <= endSample; i += windowSize) {
    const slice = channel.subarray(i, i + windowSize);
    const pitch = detectPitch(slice, sampleRate);
    const time = i / sampleRate;
    samples.push({ time, frequency: pitch });
  }

  return samples;
}

export function averageAbsoluteCentsDiff(
  reference: PitchSample[],
  actual: PitchSample[]
): number {
  if (reference.length === 0 || actual.length === 0) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < Math.min(reference.length, actual.length); i++) {
    if (reference[i].frequency <= 0 || actual[i].frequency <= 0) continue;
    total += Math.abs(centsOff(reference[i].frequency, actual[i].frequency));
    count++;
  }
  return count ? total / count : 0;
}

export function pitchStabilityScore(samples: PitchSample[]): number {
  const voiced = samples.filter((s) => s.frequency > 0);
  if (voiced.length < 5) return 50;
  const mean =
    voiced.reduce((acc, s) => acc + s.frequency, 0) / voiced.length;
  const variance =
    voiced.reduce((acc, s) => acc + Math.pow(s.frequency - mean, 2), 0) /
    voiced.length;
  const std = Math.sqrt(variance);
  const centsStd = mean > 0 ? 1200 * Math.log2((mean + std) / mean) : 0;
  const score = Math.max(0, 100 - Math.min(100, centsStd * 4));
  return Math.round(score);
}

export type PitchFrame = {
  t: number;
  f0: number;
  voiced: boolean;
};

export type PitchMetrics = {
  voicedPct: number;
  medianF0: number;
  stabilityCentsStd: number;
  stabilityScore: number;
  driftCentsPerSec: number;
  lowConfidence: boolean;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function linearSlope(x: number[], y: number[]): number {
  if (x.length === 0 || y.length === 0 || x.length !== y.length) return 0;
  const n = x.length;
  const meanX = x.reduce((acc, v) => acc + v, 0) / n;
  const meanY = y.reduce((acc, v) => acc + v, 0) / n;
  let num = 0;
  let denom = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    num += dx * (y[i] - meanY);
    denom += dx * dx;
  }
  return denom === 0 ? 0 : num / denom;
}

export async function extractPitchFromBlob(
  blob: Blob,
  stepSec = 0.05
): Promise<{ frames: PitchFrame[]; metrics: PitchMetrics }> {
  const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioContextClass();
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const channel = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const windowSize = Math.max(256, Math.floor(stepSec * sampleRate));
  const frames: PitchFrame[] = [];

  for (let i = 0; i + windowSize <= channel.length; i += windowSize) {
    const slice = channel.subarray(i, i + windowSize);
    const pitch = detectPitch(slice, sampleRate);
    const time = i / sampleRate;
    const voiced = pitch > 0;
    frames.push({ t: time, f0: pitch, voiced });
  }

  const voicedFrames = frames.filter((frame) => frame.voiced);
  const voicedPct = frames.length > 0 ? voicedFrames.length / frames.length : 0;
  const voicedF0 = voicedFrames.map((frame) => frame.f0);
  const medianF0 = median(voicedF0);
  const cents = medianF0 > 0
    ? voicedFrames.map((frame) => 1200 * Math.log2(frame.f0 / medianF0))
    : [];
  const meanCents =
    cents.length > 0 ? cents.reduce((acc, val) => acc + val, 0) / cents.length : 0;
  const variance =
    cents.length > 0
      ? cents.reduce((acc, val) => acc + Math.pow(val - meanCents, 2), 0) / cents.length
      : 0;
  const stabilityCentsStd = Math.sqrt(variance);
  const stabilityScore = Math.max(0, Math.min(100, Math.round(100 - stabilityCentsStd * 4)));
  const driftCentsPerSec = cents.length > 1
    ? linearSlope(
        voicedFrames.map((frame) => frame.t),
        cents
      )
    : 0;

  const metrics: PitchMetrics = {
    voicedPct,
    medianF0,
    stabilityCentsStd,
    stabilityScore,
    driftCentsPerSec,
    lowConfidence: voicedPct < 0.2,
  };

  await audioContext.close().catch(() => undefined);
  return { frames, metrics };
}
