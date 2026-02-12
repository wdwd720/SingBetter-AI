export type RetryOptions = {
  retries: number;
  delayMs?: number;
  isRetryable?: (err: unknown) => boolean;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isTransientError = (err: unknown) => {
  const anyErr = err as any;
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const status = typeof anyErr?.status === "number" ? anyErr.status : anyErr?.statusCode;
  const message = typeof anyErr?.message === "string" ? anyErr.message : "";
  if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;
  if (/timeout|timed out|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(message)) return true;
  if (code && /ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(code)) return true;
  return false;
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const retries = Math.max(0, options.retries);
  const delayMs = options.delayMs ?? 600;
  const isRetryable = options.isRetryable ?? isTransientError;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) {
        throw err;
      }
      attempt += 1;
      await wait(delayMs * attempt);
    }
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      (error as any).code = "TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
