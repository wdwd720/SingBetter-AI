import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useCreateSession, useFinishSession } from "@/hooks/use-sessions";
import { useAudioAnalysis } from "@/hooks/use-audio-analysis";
import { PitchVisualizer } from "@/components/PitchVisualizer";
import { X, Pause, Play, Square, Mic } from "lucide-react";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "framer-motion";

export default function SessionMode() {
  const params = useParams();
  const [_, setLocation] = useLocation();
  const mode = params.mode || "live_coach";
  
  // State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [permissionError, setPermissionError] = useState(false);
  const [micState, setMicState] = useState<PermissionState | 'unknown'>('unknown');

  // Check initial permission status
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then(status => {
        setMicState(status.state);
        status.onchange = () => setMicState(status.state);
      });
    }
  }, []);

  // Mutations
  const createSession = useCreateSession();
  const finishSession = useFinishSession();

  // Audio Hook
  const analysis = useAudioAnalysis(isRecording && !isPaused);
  
  // Timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && !isPaused) {
      interval = setInterval(() => setDuration(d => d + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused]);

  // Start/Stop Logic
  const handleToggleRecording = async () => {
    if (isRecording) {
      // Pause/Resume
      setIsPaused(!isPaused);
    } else {
      // Start
      try {
        console.log("Requesting microphone access...");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Microphone access granted:", stream.id);
        
        // Don't stop the tracks here, let the hook handle it
        
        const session = await createSession.mutateAsync({
          mode,
          goal: "pitch",
          difficulty: "beginner"
        });
        setSessionId(session.id);
        setIsRecording(true);
        setPermissionError(false);
      } catch (err) {
        console.error("Microphone permission error details:", err);
        setPermissionError(true);
      }
    }
  };

  const handleFinish = async () => {
    if (!sessionId) return;
    setIsRecording(false);
    
    // Simulate some metrics for MVP since we don't have full analysis engine yet
    const simulatedScore = Math.floor(Math.random() * 20) + 80; // 80-100 score
    
    await finishSession.mutateAsync({
      id: sessionId,
      data: {
        durationSec: duration,
        metrics: {
          overallScore: simulatedScore,
          pitchScore: simulatedScore - 2,
          stabilityScore: simulatedScore + 2,
          rhythmScore: 90,
          breathScore: 85,
          avgCentsOff: 12,
          inTunePercent: 85,
        }
      }
    });
    
    setLocation(`/results/${sessionId}`);
  };

  const handleCancel = () => {
    if (confirm("End session without saving?")) {
      setLocation("/");
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Background Ambience */}
      <div className={clsx(
        "absolute inset-0 transition-opacity duration-1000",
        isRecording && !isPaused ? "opacity-100" : "opacity-30"
      )}>
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="px-6 py-8 flex items-center justify-between z-10">
        <button 
          onClick={handleCancel}
          className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        
        <div className="flex flex-col items-center">
          <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-1">
            {isPaused ? "PAUSED" : isRecording ? "RECORDING" : "READY"}
          </span>
          <span className="font-display font-bold text-xl tabular-nums">
            {formatTime(duration)}
          </span>
        </div>

        <div className="w-10" /> {/* Spacer */}
      </header>

      {/* Main Visualizer Area */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 z-10">
        {(permissionError || micState === 'denied') ? (
          <div className="text-center max-w-xs mx-auto p-6 bg-destructive/10 border border-destructive/20 rounded-2xl">
            <Mic className="w-8 h-8 mx-auto text-destructive mb-3" />
            <h3 className="font-bold text-destructive mb-2">Microphone Access Denied</h3>
            <p className="text-sm text-destructive-foreground">
              Please allow microphone access in your browser settings to use the Live Coach.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium"
            >
              Retry After Enabling
            </button>
          </div>
        ) : (
          <PitchVisualizer 
            note={analysis.note}
            centsOff={analysis.centsOff}
            volume={analysis.volume}
            isStable={analysis.isStable}
          />
        )}
        
        {/* Real-time feedback text */}
        <AnimatePresence>
          {isRecording && !isPaused && analysis.volume > 0.1 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-12 text-center"
            >
              <div className="text-lg font-medium text-primary">
                {analysis.isStable ? "Great stability!" : "Hold it steady..."}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Controls */}
      <footer className="px-6 pb-12 pt-6 z-20">
        <div className="flex items-center justify-center gap-8">
          {isRecording && (
            <button 
              onClick={handleFinish}
              className="w-16 h-16 rounded-full bg-card border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors"
            >
              <Square className="w-6 h-6 fill-current" />
            </button>
          )}

          <button 
            onClick={handleToggleRecording}
            className={clsx(
              "w-24 h-24 rounded-full flex items-center justify-center transition-all transform hover:scale-105 active:scale-95 shadow-lg",
              isRecording 
                ? isPaused 
                  ? "bg-primary text-primary-foreground shadow-primary/20" 
                  : "bg-background border-2 border-primary text-primary"
                : "bg-primary text-primary-foreground shadow-primary/30"
            )}
          >
            {isRecording ? (
              isPaused ? <Play className="w-10 h-10 ml-1" /> : <Pause className="w-10 h-10" />
            ) : (
              <div className="flex flex-col items-center">
                <Mic className="w-8 h-8 mb-1" />
                <span className="text-xs font-bold">START</span>
              </div>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
