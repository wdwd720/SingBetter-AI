export function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/gi, "");
}

export function normalizeTokens(tokens: string[]): string[] {
  return tokens.map(normalizeToken);
}

export function safeDisplayToken(token: string): string {
  return token.replace(/\s+/g, " ").trim();
}

const collapseRepeats = (value: string) => value.replace(/(.)\1+/g, "$1");

export function phoneticNormalize(token: string): string {
  const base = normalizeToken(token);
  if (!base) return "";
  let value = base;
  value = value.replace(/ph/g, "f");
  value = value.replace(/ght/g, "t");
  value = value.replace(/ck/g, "k");
  value = value.replace(/cq/g, "k");
  value = value.replace(/qu/g, "k");
  value = value.replace(/x/g, "ks");
  value = value.replace(/kn/g, "n");
  value = value.replace(/wr/g, "r");
  value = value.replace(/wh/g, "w");
  value = value.replace(/[aeiouy]/g, "");
  value = collapseRepeats(value);
  return value;
}

export function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (!aLen || !bLen) return 0;
  const dp: number[] = Array.from({ length: bLen + 1 }, (_, i) => i);
  for (let i = 1; i <= aLen; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bLen; j += 1) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  const distance = dp[bLen];
  const maxLen = Math.max(aLen, bLen);
  return maxLen ? Math.max(0, 1 - distance / maxLen) : 0;
}
