import { useSession } from "@/hooks/use-sessions";
import { useParams, Link } from "wouter";
import { ArrowLeft, Share2, CheckCircle2, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { clsx } from "clsx";

export default function Results() {
  const { id } = useParams();
  const { data: session, isLoading } = useSession(Number(id));

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return <div>Session not found</div>;

  const metrics = session.metrics!;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <header className="px-6 py-6 flex items-center justify-between">
        <Link href="/">
          <button className="p-2 -ml-2 rounded-full hover:bg-white/5">
            <ArrowLeft className="w-6 h-6" />
          </button>
        </Link>
        <span className="font-bold">Session Summary</span>
        <button className="p-2 -mr-2 rounded-full hover:bg-white/5">
          <Share2 className="w-6 h-6" />
        </button>
      </header>

      <main className="px-6 space-y-8">
        {/* Overall Score */}
        <div className="text-center py-8">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="relative inline-block"
          >
            <svg className="w-48 h-48 transform -rotate-90">
              <circle
                cx="96" cy="96" r="88"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-white/5"
              />
              <circle
                cx="96" cy="96" r="88"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={2 * Math.PI * 88}
                strokeDashoffset={2 * Math.PI * 88 * (1 - metrics.overallScore! / 100)}
                className="text-primary"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-display font-bold">{metrics.overallScore}</span>
              <span className="text-sm text-muted-foreground uppercase tracking-wider font-bold mt-1">Excellent</span>
            </div>
          </motion.div>
        </div>

        {/* Detailed Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <MetricCard title="Pitch Accuracy" score={metrics.pitchScore!} color="text-primary" />
          <MetricCard title="Stability" score={metrics.stabilityScore!} color="text-secondary" />
          <MetricCard title="Rhythm" score={metrics.rhythmScore!} color="text-purple-500" />
          <MetricCard title="Breath Control" score={metrics.breathScore!} color="text-orange-500" />
        </div>

        {/* Feedback Section */}
        <div className="bg-card border border-white/5 p-6 rounded-3xl">
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Coach Feedback
          </h3>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
              <span>Great intonation on the high notes. Your pitch stability was consistent.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary mt-2 shrink-0" />
              <span>Try to maintain better breath support during longer phrases.</span>
            </li>
          </ul>
        </div>

        {/* Actions */}
        <Link href="/session/live_coach">
          <button className="w-full py-4 bg-white text-black font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors">
            <RefreshCw className="w-5 h-5" />
            Practice Again
          </button>
        </Link>
      </main>
    </div>
  );
}

function MetricCard({ title, score, color }: { title: string, score: number, color: string }) {
  return (
    <div className="bg-card border border-white/5 p-4 rounded-2xl">
      <div className="text-xs text-muted-foreground font-medium mb-1">{title}</div>
      <div className={clsx("text-2xl font-display font-bold", color)}>
        {score}%
      </div>
      <div className="w-full h-1 bg-white/5 rounded-full mt-2 overflow-hidden">
        <div className={clsx("h-full rounded-full", color.replace('text-', 'bg-'))} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
