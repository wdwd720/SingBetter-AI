import { describe, it, expect } from "vitest";
import { alignWords, type WordToken } from "./alignment";

describe("alignWords confidence", () => {
  it("assigns high confidence to exact matches", () => {
    const reference: WordToken[] = [{ word: "hello", start: 0, end: 0.2, index: 0 }];
    const user: WordToken[] = [{ word: "hello", start: 0, end: 0.2, index: 0 }];
    const result = alignWords(reference, user);
    expect(result.perWord[0].status).toBe("correct");
    expect(result.perWord[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.perWord[0].confidenceLabel).toBe("High");
  });

  it("assigns medium confidence to close phonetic matches", () => {
    const reference: WordToken[] = [{ word: "light", start: 0, end: 0.2, index: 0 }];
    const user: WordToken[] = [{ word: "lite", start: 0, end: 0.2, index: 0 }];
    const result = alignWords(reference, user);
    expect(result.perWord[0].status).toBe("incorrect");
    expect(result.perWord[0].confidence ?? 0).toBeGreaterThan(0.4);
    expect(["Medium", "High"]).toContain(result.perWord[0].confidenceLabel);
  });
});
