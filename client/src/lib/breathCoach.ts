import type { PitchContour } from "./pitchMetrics";

export type BreathCoach = {
  phrasingScore: number;
  issues: string[];
  tips: string[];
  drill: {
    title: string;
    steps: string[];
    targetLineIndex?: number;
    repeatCount: number;
  };
  lowConfidence: boolean;
  debug?: any;
};

type ReferenceLine = {
  index: number;
  text: string;
  start: number;
  end: number;
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

export function buildBreathCoach(input: {
  userBuffer: AudioBuffer;
  userContour: PitchContour;
  referenceLines: ReferenceLine[];
}): BreathCoach {
  const { userBuffer, userContour, referenceLines } = input;
  if (!referenceLines.length) {
    return {
      phrasingScore: 0,
      issues: [],
      tips: [],
      drill: {
        title: "Breath reset",
        steps: ["Sing the line once focusing on even airflow."],
        repeatCount: 2,
      },
      lowConfidence: true,
    };
  }

  if (userContour.frames.length === 0 || userContour.frames.filter((f) => f.voiced).length === 0) {
    return {
      phrasingScore: 0,
      issues: ["No clear voice detected"],
      tips: ["We did not detect enough voice to score phrasing."],
      drill: {
        title: "Breath reset",
        steps: ["Sing the line once focusing on even airflow."],
        repeatCount: 2,
      },
      lowConfidence: true,
    };
  }

  const sampleRate = userBuffer.sampleRate;
  const channel = userBuffer.getChannelData(0);
  const tailDrops: Array<{ line: ReferenceLine; ratio: number }> = [];
  const extraBreaths: Array<{ line: ReferenceLine; gapSec: number }> = [];

  referenceLines.forEach((line) => {
    const startSample = Math.floor(line.start * sampleRate);
    const endSample = Math.min(channel.length, Math.floor(line.end * sampleRate));
    if (endSample <= startSample) return;
    const length = endSample - startSample;
    const window = Math.max(1, Math.floor(length * 0.2));
    const firstSlice = channel.subarray(startSample, startSample + window);
    const lastSlice = channel.subarray(endSample - window, endSample);
    const firstRms = rms(firstSlice);
    const lastRms = rms(lastSlice);
    if (firstRms > 0.001 && lastRms / firstRms < 0.6) {
      tailDrops.push({ line, ratio: lastRms / firstRms });
    }

    const lineFrames = userContour.frames.filter(
      (frame) => frame.t >= line.start && frame.t <= line.end
    );
    let currentGap = 0;
    let maxGap = 0;
    for (let i = 0; i < lineFrames.length; i++) {
      if (!lineFrames[i].voiced) {
        currentGap += userContour.hopSec;
        maxGap = Math.max(maxGap, currentGap);
      } else {
        currentGap = 0;
      }
    }
    if (maxGap > 0.35) {
      extraBreaths.push({ line, gapSec: maxGap });
    }
  });

  const issues: string[] = [];
  if (tailDrops.length) {
    issues.push("Phrase tails drop");
  }
  if (extraBreaths.length) {
    issues.push("Extra breath breaks");
  }

  const phrasingScore = clamp(
    Math.round(100 - tailDrops.length * 15 - extraBreaths.length * 12),
    0,
    100
  );

  const tips: string[] = [];
  if (tailDrops[0]) {
    tips.push(
      `The end of line ${tailDrops[0].line.index + 1} fades early. Support airflow through the last word.`
    );
  }
  if (extraBreaths[0]) {
    tips.push(
      `You take a breath break in line ${extraBreaths[0].line.index + 1}. Try connecting the phrase.`
    );
  }
  if (tips.length === 0) {
    tips.push("Phrasing is steady. Keep supporting the ends of lines.");
  }

  const targetLine = tailDrops[0]?.line ?? extraBreaths[0]?.line;

  return {
    phrasingScore,
    issues,
    tips: tips.slice(0, 3),
    drill: {
      title: "Breath support drill",
      steps: [
        "Inhale for 2 seconds, exhale on a hiss for 6 seconds.",
        "Sing the target line once on a single vowel.",
        "Repeat the line 3 times without dropping the end.",
      ],
      targetLineIndex: targetLine?.index,
      repeatCount: 3,
    },
    lowConfidence: false,
    debug: {
      tailDrops: tailDrops.length,
      extraBreaths: extraBreaths.length,
    },
  };
}
