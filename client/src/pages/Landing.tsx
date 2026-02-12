import { Link } from "wouter";
import { Mic2, Music, BarChart3 } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-background/75 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic2 className="w-6 h-6 text-primary" />
            <span className="font-display font-bold text-xl tracking-tight">SingBetter AI</span>
          </div>
          <a
            href="/login"
            className="inline-flex items-center justify-center min-h-10 px-5 rounded-full bg-white text-black font-semibold text-sm tracking-tight hover:bg-gray-100 transition-colors"
          >
            Sign In
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative flex-1 flex flex-col items-center justify-center pt-36 pb-20 px-4 sm:px-6 text-center overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] -z-10 animate-pulse-slow" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[128px] -z-10 animate-pulse-slow" style={{ animationDelay: '1.5s' }} />

        <h1 className="text-5xl sm:text-7xl font-display font-bold tracking-tighter mb-7 max-w-4xl">
          Your personal <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">AI vocal coach</span>
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mb-12 leading-relaxed">
          Master perfect pitch, improve stability, and visualize your voice in real-time. 
          Professional vocal analysis, right in your pocket.
        </p>

        <a
          href="/login"
          className="group relative inline-flex items-center justify-center min-h-12 px-9 py-3 bg-primary text-primary-foreground font-bold rounded-full text-lg shadow-[0_0_40px_-14px_rgba(34,197,94,0.75)] hover:shadow-[0_0_56px_-14px_rgba(34,197,94,0.9)] transition-all transform hover:-translate-y-0.5"
        >
          Start Singing Free
          <span className="absolute inset-0 rounded-full border-2 border-white/20" />
        </a>

        {/* Feature Grid */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl w-full">
          <div className="p-7 rounded-3xl bg-card/80 border border-white/10 backdrop-blur-sm hover:bg-card transition-colors">
            <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 text-primary">
              <Mic2 className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Real-time Feedback</h3>
            <p className="text-muted-foreground">See exactly when you're sharp, flat, or perfectly in tune instantly.</p>
          </div>
          <div className="p-7 rounded-3xl bg-card/80 border border-white/10 backdrop-blur-sm hover:bg-card transition-colors">
            <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center mb-6 text-secondary">
              <BarChart3 className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Track Progress</h3>
            <p className="text-muted-foreground">Detailed analytics on your pitch accuracy, stability, and rhythm over time.</p>
          </div>
          <div className="p-7 rounded-3xl bg-card/80 border border-white/10 backdrop-blur-sm hover:bg-card transition-colors">
            <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-6 text-purple-500">
              <Music className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Smart Drills</h3>
            <p className="text-muted-foreground">Guided exercises tailored to your skill level and vocal range.</p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-5 text-sm text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/help" className="hover:text-foreground">Help</Link>
        </div>
      </div>
    </div>
  );
}
