type JobStatus = "queued" | "processing" | "completed" | "failed";

type QueueJob = {
  id: number;
  type: string;
  payload: Record<string, any>;
  status: JobStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

const queue: QueueJob[] = [];
let nextId = 1;
let workerStarted = false;

const nowIso = () => new Date().toISOString();

export const enqueueJob = (type: string, payload: Record<string, any>) => {
  const job: QueueJob = {
    id: nextId++,
    type,
    payload,
    status: "queued",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  queue.push(job);
  return job;
};

export const listJobs = (limit = 50) =>
  [...queue].sort((a, b) => b.id - a.id).slice(0, Math.max(1, limit));

const processJob = async (job: QueueJob) => {
  job.status = "processing";
  job.updatedAt = nowIso();
  try {
    // Placeholder async work; connect email/push providers here.
    await new Promise((resolve) => setTimeout(resolve, 5));
    job.status = "completed";
    job.updatedAt = nowIso();
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.updatedAt = nowIso();
  }
};

export const startQueueWorker = () => {
  if (workerStarted) return;
  workerStarted = true;
  const timer = setInterval(() => {
    const next = queue.find((job) => job.status === "queued");
    if (!next) return;
    void processJob(next);
  }, 500);
  timer.unref?.();
};

export const getQueueStatus = () => ({
  started: workerStarted,
  queued: queue.filter((job) => job.status === "queued").length,
  processing: queue.filter((job) => job.status === "processing").length,
  failed: queue.filter((job) => job.status === "failed").length,
  completed: queue.filter((job) => job.status === "completed").length,
});
