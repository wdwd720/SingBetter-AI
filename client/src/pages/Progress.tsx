import { BottomNav } from "@/components/BottomNav";
import { useProgress } from "@/hooks/use-sessions";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useMemo, useState } from "react";

export default function Progress() {
  const { data: progress, isLoading, error } = useProgress();
  const [range, setRange] = useState<"7d" | "30d" | "all">("7d");

  const chartData = useMemo(() => {
    const raw = progress?.recentScores || [];
    const now = Date.now();
    const filtered = raw.filter((entry: any) => {
      if (range === "all") return true;
      const date = new Date(entry.date).getTime();
      const maxAgeMs = range === "7d" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      return now - date <= maxAgeMs;
    });

    return filtered.map((entry: any) => ({
      name: new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      score: entry.score,
    }));
  }, [progress?.recentScores, range]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="px-6 py-8">
          <h1 className="text-2xl font-display font-bold">Your Progress</h1>
          <p className="text-sm text-muted-foreground">Loading progress...</p>
        </header>
        <BottomNav />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="px-6 py-8">
          <h1 className="text-2xl font-display font-bold">Your Progress</h1>
          <p className="text-sm text-red-300">Could not load progress right now.</p>
        </header>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="px-6 py-9">
        <h1 className="text-3xl font-display font-bold tracking-tight">Your Progress</h1>
        <p className="text-muted-foreground text-sm">Track your improvement over time</p>
      </header>

      <main className="px-6 space-y-9">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card/80 p-4 rounded-2xl border border-white/10 text-center">
            <div className="text-2xl font-display font-bold">{progress?.totalSessions || 0}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Sessions</div>
          </div>
          <div className="bg-card/80 p-4 rounded-2xl border border-white/10 text-center">
            <div className="text-2xl font-display font-bold">
              {Math.round((progress?.totalDurationSec || 0) / 60)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Minutes</div>
          </div>
          <div className="bg-card/80 p-4 rounded-2xl border border-white/10 text-center">
            <div className="text-2xl font-display font-bold text-primary">{progress?.streakDays || 0}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Day Streak</div>
          </div>
        </div>

        <div className="bg-card/80 border border-white/10 p-6 rounded-3xl h-80 shadow-[0_18px_30px_-24px_rgba(0,0,0,0.95)]">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-bold tracking-tight">Performance Trend</h3>
            <div className="flex gap-2">
              {(["7d", "30d", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRange(value)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    range === value
                      ? "border-white/25 bg-white/10 text-foreground"
                      : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" stroke="#666" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  contentStyle={{
                    backgroundColor: "#18181B",
                    border: "1px solid #333",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.score > 80 ? "#22c55e" : "#0ea5e9"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              No trend data for {range.toUpperCase()}. Complete a coaching attempt to populate this chart.
            </div>
          )}
        </div>

        <div>
          <h3 className="text-lg font-bold tracking-tight mb-4">Achievements</h3>
          <div className="bg-card/80 border border-white/10 p-4 rounded-2xl flex items-center gap-4 opacity-75">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-xs">
              Locked
            </div>
            <div>
              <div className="font-bold">Octave Master</div>
              <div className="text-xs text-muted-foreground">Hit notes across 2 octaves perfectly</div>
            </div>
          </div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
