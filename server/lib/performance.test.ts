import { describe, it, expect } from "vitest";
import { computeOverallScore, resolveWeights } from "./performance";

describe("performance scoring weights", () => {
  it("weights word score heavily in words practice mode", () => {
    const weights = resolveWeights("words");
    const overall = computeOverallScore(
      { pitch: 100, timing: 0, stability: 0, words: 100 },
      weights
    );
    expect(overall).toBeGreaterThan(70);
  });

  it("weights pitch score heavily in pitch practice mode", () => {
    const weights = resolveWeights("pitch");
    const overall = computeOverallScore(
      { pitch: 100, timing: 0, stability: 100, words: 0 },
      weights
    );
    expect(overall).toBeGreaterThan(60);
  });
});
