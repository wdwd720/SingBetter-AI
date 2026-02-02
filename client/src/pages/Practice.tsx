import { BottomNav } from "@/components/BottomNav";
import { Link } from "wouter";
import { ArrowRight, Music2, MoveVertical, Activity } from "lucide-react";

const Drills = [
  {
    id: "scales",
    title: "Major Scales",
    description: "Practice your do-re-mi fundamentals",
    icon: Music2,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    difficulty: "Beginner"
  },
  {
    id: "intervals",
    title: "Perfect Intervals",
    description: "Train your ear to jump between notes",
    icon: MoveVertical,
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    difficulty: "Intermediate"
  },
  {
    id: "agility",
    title: "Vocal Agility",
    description: "Fast runs and melismatic control",
    icon: Activity,
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    difficulty: "Advanced"
  }
];

export default function Practice() {
  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="px-6 py-8">
        <h1 className="text-2xl font-display font-bold">Practice Drills</h1>
        <p className="text-muted-foreground text-sm">Guided exercises to improve specific skills</p>
      </header>

      <main className="px-6 space-y-4">
        {Drills.map((drill) => (
          <Link key={drill.id} href={`/session/${drill.id}`}>
            <div className="bg-card border border-white/5 p-5 rounded-3xl flex items-center gap-4 cursor-pointer hover:bg-white/5 transition-colors group">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${drill.bg} ${drill.color}`}>
                <drill.icon className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-lg">{drill.title}</h3>
                  <span className="text-[10px] uppercase font-bold tracking-wider bg-white/5 px-2 py-1 rounded-full text-muted-foreground">
                    {drill.difficulty}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{drill.description}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </Link>
        ))}
      </main>
      <BottomNav />
    </div>
  );
}
