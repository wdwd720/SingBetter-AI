import { describe, it, expect } from "vitest";
import { estimateAlignmentOffsetMs } from "./offset";

describe("estimateAlignmentOffsetMs", () => {
  it("estimates positive lag when recording starts late", () => {
    const reference = [0, 0, 0.1, 0.4, 0.8, 0.5, 0.2, 0];
    const recording = [0, 0, 0, 0, 0.1, 0.4, 0.8, 0.5, 0.2];
    const estimate = estimateAlignmentOffsetMs(reference, recording, { stepSec: 0.05, maxOffsetMs: 500 });
    expect(estimate.method).toBeDefined();
    expect(estimate.offsetMs).toBeGreaterThanOrEqual(100);
  });
});
