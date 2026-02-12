import { computeSpectrum } from "./fft";

export type DictionWord = {
  word: string;
  start: number;
  end: number;
  clarity: number;
  issues: string[];
  lineIndex?: number;
};

export type DictionCoach = {
  clarityScore: number;
  worstWords: DictionWord[];
  topIssues: string[];
  tips: string[];
  drill: {
    title: string;
    steps: string[];
    targetWords?: string[];
    targetLineIndex?: number;
    repeatCount: number;
  };
  lowConfidence: boolean;
  debug?: any;
};

type AlignmentInput = {
  perWord?: Array<{
    refIndex: number;
    status: string;
    deltaMs?: number;
  }>;
} | null;

type ReferenceWord = {
  word: string;
  start: number;
  end: number;
  lineIndex?: number;
  refIndex?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const rms = (buffer: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
};

const zcr = (buffer: Float32Array) => {
  let crossings = 0;
  for (let i = 1; i < buffer.length; i++) {
    if ((buffer[i - 1] >= 0 && buffer[i] < 0) || (buffer[i - 1] < 0 && buffer[i] >= 0)) {
      crossings += 1;
    }
  }
  return crossings / Math.max(1, buffer.length - 1);
};

const spectralCentroid = (buffer: Float32Array, sampleRate: number) => {
  const { magnitudes, size } = computeSpectrum(buffer);
  let num = 0;
  let denom = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    const mag = magnitudes[i];
    const freq = (i * sampleRate) / size;
    num += freq * mag;
    denom += mag;
  }
  return denom > 0 ? num / denom : 0;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
};

const buildNormalizer = (values: number[]) => {
  const p10 = percentile(values, 0.1);
  const p90 = percentile(values, 0.9);
  const span = p90 - p10 || 1e-6;
  return (value: number) => clamp((value - p10) / span, 0, 1);
};

export async function buildDictionCoach(input: {
  userBuffer: AudioBuffer;
  referenceWords: ReferenceWord[];
  alignment?: AlignmentInput;
}): Promise<DictionCoach> {
  const { userBuffer, referenceWords, alignment } = input;
  const channel = userBuffer.getChannelData(0);
  const sampleRate = userBuffer.sampleRate;
  const duration = userBuffer.duration;
  const windowPad = 0.08;

  if (referenceWords.length === 0) {
    return {
      clarityScore: 0,
      worstWords: [],
      topIssues: ["No reference words available"],
      tips: ["Re-run transcription to enable diction coaching."],
      drill: {
        title: "Clear words drill",
        steps: ["Speak the line slowly once, then sing it once."],
        repeatCount: 2,
      },
      lowConfidence: true,
    };
  }

  const alignmentMap = new Map<number, string>();
  alignment?.perWord?.forEach((word) => {
    alignmentMap.set(word.refIndex, word.status);
  });

  const features = referenceWords.map((word, idx) => {
    const refIndex = word.refIndex ?? idx;
    const start = clamp(word.start - windowPad, 0, duration);
    const end = clamp(word.end + windowPad, 0, duration);
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.max(startSample + 1, Math.floor(end * sampleRate));
    const slice = channel.subarray(startSample, Math.min(channel.length, endSample));

    const onsetStart = Math.max(0, Math.floor((word.start) * sampleRate));
    const onsetEnd = Math.max(onsetStart + 1, Math.floor((word.start + windowPad) * sampleRate));
    const preStart = Math.max(0, Math.floor((word.start - windowPad) * sampleRate));
    const preEnd = Math.max(preStart + 1, Math.floor((word.start) * sampleRate));

    const onsetSlice = channel.subarray(onsetStart, Math.min(channel.length, onsetEnd));
    const preSlice = channel.subarray(preStart, Math.min(channel.length, preEnd));

    const rmsValue = rms(slice);
    const zcrValue = zcr(slice);
    const centroid = spectralCentroid(slice.length > 1024 ? slice.subarray(0, 1024) : slice, sampleRate);
    const onsetValue = Math.max(0, rms(onsetSlice) - rms(preSlice));

    return {
      refIndex,
      word: word.word,
      start: word.start,
      end: word.end,
      lineIndex: word.lineIndex,
      rms: rmsValue,
      zcr: zcrValue,
      centroid,
      onset: onsetValue,
      status: alignmentMap.get(refIndex),
    };
  });

  const rmsNorm = buildNormalizer(features.map((f) => f.rms));
  const zcrNorm = buildNormalizer(features.map((f) => f.zcr));
  const centroidNorm = buildNormalizer(features.map((f) => f.centroid));
  const onsetNorm = buildNormalizer(features.map((f) => f.onset));

  const scored: DictionWord[] = features.map((feature) => {
    const clarity =
      onsetNorm(feature.onset) * 0.35 +
      rmsNorm(feature.rms) * 0.25 +
      centroidNorm(feature.centroid) * 0.2 +
      zcrNorm(feature.zcr) * 0.2;

    const issues: string[] = [];
    if (clarity < 0.35) issues.push("unclear articulation");
    if (rmsNorm(feature.rms) < 0.3) issues.push("weak energy");
    if (onsetNorm(feature.onset) < 0.3) issues.push("soft consonant");
    if (zcrNorm(feature.zcr) < 0.25) issues.push("muffled");

    if ((feature.status === "missed" || feature.status === "incorrect") && rmsNorm(feature.rms) > 0.4) {
      issues.push("pronunciation mismatch");
    }

    return {
      word: feature.word,
      start: feature.start,
      end: feature.end,
      clarity: Math.round(clamp(clarity * 100, 0, 100)),
      issues,
      lineIndex: feature.lineIndex,
    };
  });

  const averageRms = features.reduce((acc, f) => acc + f.rms, 0) / Math.max(1, features.length);
  const lowConfidence = averageRms < 0.008 || scored.filter((word) => word.clarity > 30).length < features.length * 0.3;

  if (lowConfidence) {
    return {
      clarityScore: 0,
      worstWords: scored.slice(0, 5),
      topIssues: ["Low vocal clarity"],
      tips: ["We did not capture enough clear articulation. Move closer and try again."],
      drill: {
        title: "Clear diction reset",
        steps: ["Speak the line clearly once, then sing it softly with exaggerated consonants."],
        repeatCount: 2,
      },
      lowConfidence: true,
    };
  }

  const clarityScore = Math.round(
    scored.reduce((acc, word) => acc + word.clarity, 0) / Math.max(1, scored.length)
  );

  const worstWords = [...scored].sort((a, b) => a.clarity - b.clarity).slice(0, 5);

  const issueCounts = new Map<string, number>();
  scored.forEach((word) => {
    word.issues.forEach((issue) => {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    });
  });
  const topIssues = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([issue]) => issue);

  const tips: string[] = [];
  if (topIssues.includes("pronunciation mismatch")) {
    tips.push("Some words are articulated but do not match the reference. Slow down and shape the vowels.");
  }
  if (topIssues.includes("soft consonant")) {
    tips.push("Consonant starts are soft. Lean into the first consonant of each word.");
  }
  if (topIssues.includes("muffled")) {
    tips.push("Brighten the tone slightly for clearer diction.");
  }
  if (topIssues.includes("weak energy")) {
    tips.push("Projection is low. Try a slightly stronger, supported airflow.");
  }
  if (tips.length < 3) {
    tips.push("Speak the line in rhythm once, then sing it again with clear word starts.");
  }

  const targetWords = worstWords.map((word) => word.word).filter(Boolean);
  const targetLineIndex =
    features.find((f) => f.word === worstWords[0]?.word && f.lineIndex !== undefined)?.lineIndex;

  return {
    clarityScore,
    worstWords,
    topIssues,
    tips: tips.slice(0, 5),
    drill: {
      title: "Diction drill",
      steps: [
        "Listen once to the reference line.",
        `Speak the target words clearly 3 times: ${targetWords.slice(0, 3).join(", ")}.`,
        "Sing the line on one vowel, then add the real words.",
        "Record again with crisp consonants.",
      ],
      targetWords,
      targetLineIndex,
      repeatCount: 3,
    },
    lowConfidence: false,
    debug: {
      averageRms,
    },
  };
}
