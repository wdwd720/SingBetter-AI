import { clsx } from "clsx";
import type { Verse } from "./types";

type VerseSelectorProps = {
  verses: Verse[];
  selectedIndex: number;
  verseCount: number;
  onSelect: (index: number) => void;
  onCountChange: (count: number) => void;
};

const countOptions = [1, 2, 3, 4];

export function VerseSelector({
  verses,
  selectedIndex,
  verseCount,
  onSelect,
  onCountChange,
}: VerseSelectorProps) {
  const buildPreview = (verse: Verse) => {
    const base = verse.lines.length ? verse.lines.join(" ") : verse.text;
    const trimmed = base.replace(/\s+/g, " ").trim();
    if (trimmed.length <= 140) return trimmed;
    return `${trimmed.slice(0, 140).trim()}...`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Practice Scope
        </h3>
        <div className="flex gap-2">
          {countOptions.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => onCountChange(count)}
              className={clsx(
                "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                count === verseCount
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-white/10 text-muted-foreground hover:text-foreground"
              )}
            >
              {count} verse{count > 1 ? "s" : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {verses.map((verse) => (
          <button
            key={verse.index}
            type="button"
            onClick={() => onSelect(verse.index)}
            className={clsx(
              "text-left p-4 rounded-2xl border transition-colors w-full max-w-full",
              selectedIndex === verse.index
                ? "border-primary/60 bg-primary/10"
                : "border-white/5 bg-card hover:border-white/20"
            )}
          >
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Verse {verse.index + 1}
            </div>
            <div
              className="text-sm font-medium text-foreground whitespace-normal break-words overflow-hidden"
              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
            >
              {buildPreview(verse)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

