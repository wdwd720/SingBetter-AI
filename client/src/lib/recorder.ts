export type RecorderFrame = {
  timeSec: number;
  buffer: Float32Array;
  sampleRate: number;
};

export type RecorderController = {
  stop: () => Promise<{ blob: Blob; durationSec: number }>;
  stream: MediaStream;
  audioContext: AudioContext | null;
};

export type CalibrationSample = {
  metrics: import("./audioMetrics").CalibrationMetrics;
  durationSec: number;
};

export async function startRecorder(
  stream: MediaStream,
  onFrame?: (frame: RecorderFrame) => void
): Promise<RecorderController> {
  if (!stream || stream.getAudioTracks().length === 0) {
    throw new Error("Microphone stream not available");
  }
  const recorder = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  let stopped = false;
  let stopPromise: Promise<{ blob: Blob; durationSec: number }> | null = null;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.start();

  const audioContext =
    onFrame !== undefined
      ? new (window.AudioContext || (window as any).webkitAudioContext)()
      : null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId: number | null = null;
  const startTime = performance.now();

  if (audioContext) {
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => undefined);
    }
    source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const dataArray = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!analyser || !audioContext) return;
      analyser.getFloatTimeDomainData(dataArray);
      const timeSec = (performance.now() - startTime) / 1000;
      onFrame?.({ timeSec, buffer: dataArray, sampleRate: audioContext.sampleRate });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = new Promise<{ blob: Blob; durationSec: number }>((resolve) => {
      const finalize = () => {
        if (stopped) return;
        stopped = true;
        if (rafId) cancelAnimationFrame(rafId);
        if (source) source.disconnect();
        if (analyser) analyser.disconnect();
        if (audioContext && audioContext.state !== "closed") {
          void audioContext.close().catch(() => undefined);
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const durationSec = (performance.now() - startTime) / 1000;
        resolve({ blob, durationSec });
      };

      recorder.onstop = finalize;
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        finalize();
      }
    });
    return stopPromise;
  };

  return { stop, stream, audioContext };
}

export async function recordCalibrationSample(
  stream: MediaStream,
  durationSec = 3
): Promise<CalibrationSample> {
  const { createAudioStatsAccumulator } = await import("./audioMetrics");
  const stats = createAudioStatsAccumulator();
  const controller = await startRecorder(stream, (frame) => {
    stats.push(frame.buffer);
  });

  await new Promise((resolve) => setTimeout(resolve, Math.max(1, durationSec) * 1000));
  const result = await controller.stop();
  return {
    metrics: stats.finalize(result.durationSec),
    durationSec: result.durationSec,
  };
}
