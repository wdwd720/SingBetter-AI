import { useAuth } from "@/hooks/use-auth";
import { useProgress } from "@/hooks/use-sessions";
import { BottomNav } from "@/components/BottomNav";
import { Link } from "wouter";
import { Mic2, Trophy, ArrowRight, Zap, Activity } from "lucide-react";
import { clsx } from "clsx";

export default function Home() {
  const { user } = useAuth();
  const { data: progress } = useProgress();

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-md mx-auto px-6 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <p className="text-muted-foreground font-medium text-sm mb-1">{greeting()},</p>
            <h1 className="text-2xl font-display font-bold">{user?.firstName || "Singer"}</h1>
          </div>
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-secondary p-[2px]">
            <img 
              src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${user?.firstName || 'User'}&background=random`} 
              alt="Profile" 
              className="w-full h-full rounded-full object-cover bg-background"
            />
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-card p-4 rounded-2xl border border-white/5">
            <div className="flex items-center gap-2 mb-2 text-primary">
              <Zap className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Streak</span>
            </div>
            <div className="text-3xl font-display font-bold">{progress?.streakDays || 0}</div>
            <div className="text-xs text-muted-foreground">Day streak</div>
          </div>
          <div className="bg-card p-4 rounded-2xl border border-white/5">
            <div className="flex items-center gap-2 mb-2 text-secondary">
              <Activity className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Avg Score</span>
            </div>
            <div className="text-3xl font-display font-bold">{Math.round(progress?.averageScore || 0)}</div>
            <div className="text-xs text-muted-foreground">Last 7 days</div>
          </div>
        </div>

        {/* Quick Action - Start Session */}
        <div className="mb-8">
          <h2 className="text-lg font-bold mb-4">Start Practicing</h2>
          <div className="grid gap-4">
            <Link href="/session/live_coach">
              <div className="group relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 p-6 rounded-3xl cursor-pointer transition-all active:scale-[0.98]">
                <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:scale-110 transition-transform">
                  <Mic2 className="w-16 h-16 text-primary" />
                </div>
                <div className="relative z-10">
                  <div className="bg-primary/20 w-fit p-2 rounded-xl mb-4 text-primary">
                    <Mic2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Live Coach</h3>
                  <p className="text-sm text-muted-foreground mb-4">Real-time pitch detection & feedback</p>
                  <div className="flex items-center text-primary font-semibold text-sm">
                    Start Session <ArrowRight className="w-4 h-4 ml-1" />
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/practice">
              <div className="bg-card border border-white/5 p-6 rounded-3xl flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="bg-secondary/10 p-3 rounded-xl text-secondary">
                    <Trophy className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold">Guided Drills</h3>
                    <p className="text-xs text-muted-foreground">Warmups, intervals, agility</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-lg font-bold mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {progress?.recentScores?.length ? (
              progress.recentScores.map((session: any, i: number) => (
                <div key={i} className="bg-card border border-white/5 p-4 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-10 rounded-full bg-primary/20" />
                    <div>
                      <div className="font-medium">Vocal Practice</div>
                      <div className="text-xs text-muted-foreground">{new Date(session.date).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="font-display font-bold text-xl">{session.score}</div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm bg-card/50 rounded-2xl border border-dashed border-white/10">
                No sessions yet. Start your first practice!
              </div>
            )}
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
