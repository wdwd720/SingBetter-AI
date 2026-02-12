import { normalizeToken, phoneticNormalize, tokenSimilarity } from "./normalize";

export type WordToken = {
  word: string;
  start: number;
  end: number;
  index: number;
  lineIndex?: number;
};

export type AlignmentStatus =
  | "correct"
  | "correct_early"
  | "correct_late"
  | "incorrect"
  | "missed"
  | "extra_ignored";

export type AlignmentWordResult = {
  refIndex: number;
  refWord: string;
  refStart: number;
  refEnd: number;
  status: AlignmentStatus;
  userWord?: string;
  userStart?: number;
  userEnd?: number;
  deltaMs?: number;
  confidence?: number;
  confidenceLabel?: "High" | "Medium" | "Low";
};

export type AlignmentMetrics = {
  wordAccuracyPct: number;
  timingMeanAbsMs: number;
  paceRatio: number;
  missedWords: string[];
  extraWords: string[];
};

export type AlignmentResult = {
  perWord: AlignmentWordResult[];
  extras: WordToken[];
  metrics: AlignmentMetrics;
};

type AlignmentOptions = {
  referenceOffsetSec?: number;
  userOffsetSec?: number;
  earlyLateThresholdMs?: number;
  referenceDurationSec?: number;
  userDurationSec?: number;
};

type Op = "match" | "delete" | "insert";

const confidenceLabel = (value?: number) => {
  if (typeof value !== "number") return "Low";
  if (value >= 0.78) return "High";
  if (value >= 0.5) return "Medium";
  return "Low";
};

const computeSimilarity = (a: string, b: string) => {
  if (!a || !b) return 0;
  const softA = phoneticNormalize(a);
  const softB = phoneticNormalize(b);
  if (!softA || !softB) return 0;
  return tokenSimilarity(softA, softB);
};

export function alignWords(
  reference: WordToken[],
  user: WordToken[],
  options: AlignmentOptions = {}
): AlignmentResult {
  const n = reference.length;
  const m = user.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0)
  );
  const back: Op[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => "match")
  );

  for (let i = 1; i <= n; i++) {
    dp[i][0] = i;
    back[i][0] = "delete";
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j;
    back[0][j] = "insert";
  }

  for (let i = 1; i <= n; i++) {
    const refNorm = normalizeToken(reference[i - 1].word);
    for (let j = 1; j <= m; j++) {
      const userNorm = normalizeToken(user[j - 1].word);
      const similarity = refNorm === userNorm ? 1 : computeSimilarity(refNorm, userNorm);
      const subCost = refNorm === userNorm ? 0 : similarity >= 0.7 ? 0.5 : 1;
      const matchCost = dp[i - 1][j - 1] + subCost;
      const deleteCost = dp[i - 1][j] + 1;
      const insertCost = dp[i][j - 1] + 1;

      let minCost = matchCost;
      let op: Op = "match";
      if (deleteCost < minCost) {
        minCost = deleteCost;
        op = "delete";
      }
      if (insertCost < minCost) {
        minCost = insertCost;
        op = "insert";
      }
      dp[i][j] = minCost;
      back[i][j] = op;
    }
  }

  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const op = back[i][j];
    ops.push(op);
    if (op === "match") {
      i -= 1;
      j -= 1;
    } else if (op === "delete") {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  ops.reverse();

  const perWord: AlignmentWordResult[] = [];
  const extras: WordToken[] = [];
  const missedWords: string[] = [];
  const extraWords: string[] = [];
  const matchedDeltas: number[] = [];
  const earlyLateThreshold = options.earlyLateThresholdMs ?? 200;
  const refOffset = options.referenceOffsetSec ?? 0;
  const userOffset = options.userOffsetSec ?? 0;

  let refIndex = 0;
  let userIndex = 0;
  ops.forEach((op) => {
    if (op === "match") {
      const refWord = reference[refIndex];
      const userWord = user[userIndex];
      const refNorm = normalizeToken(refWord.word);
      const userNorm = normalizeToken(userWord.word);
      const isCorrect = refNorm.length > 0 && refNorm === userNorm;
      const similarity = isCorrect ? 1 : computeSimilarity(refNorm, userNorm);
      const confidence = similarity;

      const refStartRel = refWord.start - refOffset;
      const userStartRel = userWord.start - userOffset;
      const deltaMs = Math.round((userStartRel - refStartRel) * 1000);

      let status: AlignmentStatus = "incorrect";
      if (isCorrect) {
        if (deltaMs < -earlyLateThreshold) status = "correct_early";
        else if (deltaMs > earlyLateThreshold) status = "correct_late";
        else status = "correct";
        matchedDeltas.push(Math.abs(deltaMs));
      }

      perWord.push({
        refIndex: refWord.index,
        refWord: refWord.word,
        refStart: refStartRel,
        refEnd: refWord.end - refOffset,
        status,
        userWord: userWord.word,
        userStart: userStartRel,
        userEnd: userWord.end - userOffset,
        deltaMs,
        confidence,
        confidenceLabel: confidenceLabel(confidence),
      });

      if (!isCorrect) {
        missedWords.push(refWord.word);
      }

      refIndex += 1;
      userIndex += 1;
      return;
    }
    if (op === "delete") {
      const refWord = reference[refIndex];
      perWord.push({
        refIndex: refWord.index,
        refWord: refWord.word,
        refStart: refWord.start - refOffset,
        refEnd: refWord.end - refOffset,
        status: "missed",
        confidence: 0,
        confidenceLabel: "Low",
      });
      missedWords.push(refWord.word);
      refIndex += 1;
      return;
    }
    const extra = user[userIndex];
    extras.push(extra);
    extraWords.push(extra.word);
    userIndex += 1;
  });

  const correctCount = perWord.filter((word) =>
    word.status === "correct" ||
    word.status === "correct_early" ||
    word.status === "correct_late"
  ).length;
  const wordAccuracyPct = perWord.length
    ? Math.round((correctCount / perWord.length) * 100)
    : 0;
  const timingMeanAbsMs = matchedDeltas.length
    ? Math.round(matchedDeltas.reduce((acc, val) => acc + val, 0) / matchedDeltas.length)
    : 0;

  const refDuration = options.referenceDurationSec ?? 0;
  const userDuration = options.userDurationSec ?? 0;
  const paceRatio =
    refDuration > 0 && userDuration > 0 ? userDuration / refDuration : 1;

  return {
    perWord,
    extras,
    metrics: {
      wordAccuracyPct,
      timingMeanAbsMs,
      paceRatio,
      missedWords,
      extraWords,
    },
  };
}
