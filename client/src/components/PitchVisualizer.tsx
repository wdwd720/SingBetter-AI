import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { clsx } from "clsx";

interface PitchVisualizerProps {
  note: string;
  centsOff: number;
  volume: number;
  isStable: boolean;
  targetNote?: string;
}

export function PitchVisualizer({ note, centsOff, volume, isStable, targetNote }: PitchVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<number[]>([]);

  // Draw scrolling pitch graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Add current cent offset to history (normalized 0-100 where 50 is center)
    // Only record if there is volume, else record null (break in line)
    const val = volume > 0.05 ? 50 + centsOff : -999;
    historyRef.current.push(val);
    if (historyRef.current.length > 100) historyRef.current.shift();

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Draw center line
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 1;
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Draw safe zone
      ctx.fillStyle = "rgba(34, 197, 94, 0.05)";
      ctx.fillRect(0, h / 2 - h * 0.15, w, h * 0.3);

      // Draw pitch line
      ctx.beginPath();
      ctx.strokeStyle = isStable ? "#22c55e" : "#0ea5e9";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      let hasStarted = false;
      const step = w / 100;

      historyRef.current.forEach((val, i) => {
        if (val === -999) {
          hasStarted = false;
          return;
        }

        const x = i * step;
        const y = h / 2 - (val - 50) * (h / 100); // Scale deviation

        if (!hasStarted) {
          ctx.moveTo(x, y);
          hasStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
    };

    const raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [centsOff, volume, isStable]);

  // Visual cues
  const isInTune = Math.abs(centsOff) < 15 && volume > 0.1;
  const isSharp = centsOff > 15;
  const isFlat = centsOff < -15;

  return (
    <div className="relative w-full max-w-xs mx-auto aspect-square flex flex-col items-center justify-center">
      {/* Background Circles */}
      <div className="absolute inset-0 rounded-full border border-white/5 animate-pulse-slow" />
      <div className="absolute inset-4 rounded-full border border-white/5" />
      <div className="absolute inset-12 rounded-full border border-white/5" />

      {/* Centered Note Display */}
      <div className="relative z-10 flex flex-col items-center">
        <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">
          {targetNote ? `Target: ${targetNote}` : "Current Note"}
        </div>
        <div 
          className={clsx(
            "text-6xl font-display font-bold transition-all duration-300",
            isInTune ? "text-primary scale-110 text-glow" : "text-foreground"
          )}
        >
          {note !== "-" ? note : "--"}
        </div>
        <div className={clsx(
          "text-sm font-medium mt-2 px-3 py-1 rounded-full transition-colors",
          isInTune ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {isInTune ? "Perfect" : isSharp ? "Too High" : isFlat ? "Too Low" : "Sing a note"}
        </div>
      </div>

      {/* Cents Offset Indicator (Needle) */}
      <div className="absolute w-full h-full rounded-full overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-0 left-1/2 w-1 h-8 bg-primary origin-bottom rounded-full"
          style={{ top: '10%' }}
          animate={{
            rotate: volume > 0.1 ? centsOff * 1.5 : 0, // Amplify rotation for visual effect
            opacity: volume > 0.1 ? 1 : 0.3
          }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        />
      </div>

      {/* Live Graph Canvas Overlay */}
      <div className="absolute -bottom-24 left-0 right-0 h-24 w-full opacity-50 pointer-events-none">
        <canvas ref={canvasRef} width={320} height={100} className="w-full h-full" />
      </div>
    </div>
  );
}
