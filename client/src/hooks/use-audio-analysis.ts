import { useState, useEffect, useRef, useCallback } from "react";

export interface AudioAnalysis {
  volume: number; // 0-1
  pitch: number; // Frequency in Hz
  note: string; // Scientific pitch notation (e.g., "A4")
  centsOff: number; // -50 to +50
  isStable: boolean;
}

const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function useAudioAnalysis(isListening: boolean) {
  const [analysis, setAnalysis] = useState<AudioAnalysis>({
    volume: 0,
    pitch: 0,
    note: "-",
    centsOff: 0,
    isStable: false,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const startListening = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone access not supported");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Web Audio API not supported");
      }

      const audioContext = new AudioContextClass();

      // IMPORTANT: Resume AudioContext (Chrome/Safari requirement)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 2048;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const update = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);
        
        // 1. Calculate Volume (RMS)
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const volume = Math.min(average / 128, 1);

        // 2. Mock Pitch Detection (Web Audio API requires complex autocorrelation for real pitch)
        // For MVP visuals, we'll simulate pitch data when volume is significant
        let pitch = 0;
        let note = "-";
        let centsOff = 0;
        let isStable = false;

        if (volume > 0.1) {
          // Find peak frequency bin
          let maxVal = -1;
          let maxIndex = -1;
          for (let i = 0; i < bufferLength; i++) {
            if (dataArray[i] > maxVal) {
              maxVal = dataArray[i];
              maxIndex = i;
            }
          }

          // Approx frequency = index * sampleRate / fftSize
          // This is rough but gives us *some* reactive movement
          const sampleRate = audioContext.sampleRate;
          const roughFreq = maxIndex * sampleRate / analyser.fftSize;

          if (roughFreq > 80 && roughFreq < 1000) { // Human vocal range approx
            pitch = roughFreq;
            
            // Calculate note
            const noteNum = 12 * (Math.log(pitch / 440) / Math.log(2));
            const noteIndex = Math.round(noteNum) + 69;
            const octave = Math.floor(noteIndex / 12) - 1;
            const noteName = NOTE_STRINGS[noteIndex % 12];
            note = `${noteName}${octave}`;
            
            // Calculate cents off
            centsOff = Math.floor((noteNum - Math.round(noteNum)) * 100);
            
            // Stability heuristic
            isStable = Math.abs(centsOff) < 15;
          }
        }

        setAnalysis({ volume, pitch, note, centsOff, isStable });
        rafRef.current = requestAnimationFrame(update);
      };

      update();
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) sourceRef.current.disconnect();
    if (analyserRef.current) analyserRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    
    setAnalysis({ volume: 0, pitch: 0, note: "-", centsOff: 0, isStable: false });
  }, []);

  useEffect(() => {
    if (isListening) {
      startListening();
    } else {
      stopListening();
    }
    return () => stopListening();
  }, [isListening, startListening, stopListening]);

  return analysis;
}
