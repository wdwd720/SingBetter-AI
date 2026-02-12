type SegmentWord = { start: number; end: number; word: string };
type Segment = { start: number; end: number; text: string; words?: SegmentWord[] };

export type KaraokeWord = {
  word: string;
  start: number;
  end: number;
  segmentIndex: number;
};

export function flattenWords(segments: Segment[]): KaraokeWord[] {
  const words: KaraokeWord[] = [];
  segments.forEach((segment, segmentIndex) => {
    const trimmedText = segment.text?.trim() ?? "";
    if (segment.words && segment.words.length > 0) {
      segment.words.forEach((word) => {
        if (!word.word) return;
        words.push({
          word: word.word,
          start: word.start,
          end: word.end,
          segmentIndex,
        });
      });
      return;
    }
    if (!trimmedText) return;
    const tokens = trimmedText.split(/\s+/).filter(Boolean);
    const duration = Math.max(0.01, segment.end - segment.start);
    tokens.forEach((token, index) => {
      const start = segment.start + (duration * index) / tokens.length;
      const end = segment.start + (duration * (index + 1)) / tokens.length;
      words.push({
        word: token,
        start,
        end,
        segmentIndex,
      });
    });
  });
  return words;
}
