import { Link } from "wouter";
import { Mic2, Music, BarChart3 } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic2 className="w-6 h-6 text-primary" />
            <span className="font-display font-bold text-xl tracking-tight">SingBetter AI</span>
          </div>
          <a
            href="/api/login"
            className="px-5 py-2 rounded-full bg-white text-black font-semibold text-sm hover:bg-gray-200 transition-colors"
          >
            Sign In
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative flex-1 flex flex-col items-center justify-center pt-32 pb-16 px-4 sm:px-6 text-center overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] -z-10 animate-pulse-slow" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[128px] -z-10 animate-pulse-slow" style={{ animationDelay: '1.5s' }} />

        <h1 className="text-5xl sm:text-7xl font-display font-bold tracking-tighter mb-6 max-w-3xl">
          Your personal <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">AI vocal coach</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mb-10 leading-relaxed">
          Master perfect pitch, improve stability, and visualize your voice in real-time. 
          Professional vocal analysis, right in your pocket.
        </p>

        <a
          href="/api/login"
          className="group relative px-8 py-4 bg-primary text-primary-foreground font-bold rounded-full text-lg shadow-[0_0_40px_-10px_rgba(34,197,94,0.6)] hover:shadow-[0_0_60px_-10px_rgba(34,197,94,0.8)] transition-all transform hover:-translate-y-1"
        >
          Start Singing Free
          <span className="absolute inset-0 rounded-full border-2 border-white/20" />
        </a>

        {/* Feature Grid */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl w-full">
          <div className="p-8 rounded-3xl bg-card border border-white/5 backdrop-blur-sm">
            <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 text-primary">
              <Mic2 className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-3">Real-time Feedback</h3>
            <p className="text-muted-foreground">See exactly when you're sharp, flat, or perfectly in tune instantly.</p>
          </div>
          <div className="p-8 rounded-3xl bg-card border border-white/5 backdrop-blur-sm">
            <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center mb-6 text-secondary">
              <BarChart3 className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-3">Track Progress</h3>
            <p className="text-muted-foreground">Detailed analytics on your pitch accuracy, stability, and rhythm over time.</p>
          </div>
          <div className="p-8 rounded-3xl bg-card border border-white/5 backdrop-blur-sm">
            <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-6 text-purple-500">
              <Music className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-3">Smart Drills</h3>
            <p className="text-muted-foreground">Guided exercises tailored to your skill level and vocal range.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
