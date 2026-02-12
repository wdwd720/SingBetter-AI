const sensitiveKeyPattern =
  /password|token|secret|authorization|cookie|set-cookie|api[-_]?key/i;

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (sensitiveKeyPattern.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactValue(nestedValue);
      }
    }
    return output;
  }
  return value;
};

export const redactSensitive = <T>(value: T): T => redactValue(value) as T;
