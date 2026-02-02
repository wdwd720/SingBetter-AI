import { BottomNav } from "@/components/BottomNav";
import { useProgress } from "@/hooks/use-sessions";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function Progress() {
  const { data: progress } = useProgress();

  // Format data for Recharts
  const chartData = progress?.recentScores?.slice(0, 7).reverse().map((d: any) => ({
    name: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
    score: d.score
  })) || [];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="px-6 py-8">
        <h1 className="text-2xl font-display font-bold">Your Progress</h1>
        <p className="text-muted-foreground text-sm">Track your improvement over time</p>
      </header>

      <main className="px-6 space-y-8">
        {/* Overview Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card p-3 rounded-2xl border border-white/5 text-center">
            <div className="text-2xl font-display font-bold">{progress?.totalSessions || 0}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Sessions</div>
          </div>
          <div className="bg-card p-3 rounded-2xl border border-white/5 text-center">
            <div className="text-2xl font-display font-bold">
              {Math.round((progress?.totalDurationSec || 0) / 60)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Minutes</div>
          </div>
          <div className="bg-card p-3 rounded-2xl border border-white/5 text-center">
            <div className="text-2xl font-display font-bold text-primary">{progress?.streakDays || 0}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Day Streak</div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-card border border-white/5 p-6 rounded-3xl h-80">
          <h3 className="font-bold mb-6">Performance Trend</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis 
                dataKey="name" 
                stroke="#666" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false} 
              />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                contentStyle={{ backgroundColor: '#18181B', border: '1px solid #333', borderRadius: '8px' }}
              />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {chartData.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.score > 80 ? '#22c55e' : '#0ea5e9'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Achievements Placeholder */}
        <div>
          <h3 className="font-bold mb-4">Achievements</h3>
          <div className="bg-card border border-white/5 p-4 rounded-2xl flex items-center gap-4 opacity-50">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">🔒</div>
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
