import { z } from 'zod';
import { insertSessionSchema, insertSessionMetricsSchema, insertSessionEventSchema, singingSessions, sessionMetrics, sessionEvents } from './schema';
export type { CreateSessionRequest, FinishSessionRequest } from "./schema";

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
};

export const api = {
  sessions: {
    create: {
      method: 'POST' as const,
      path: '/api/sessions',
      input: insertSessionSchema,
      responses: {
        201: z.custom<typeof singingSessions.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/sessions',
      input: z.object({
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof singingSessions.$inferSelect & { metrics?: typeof sessionMetrics.$inferSelect }>()),
        401: errorSchemas.unauthorized,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/sessions/:id',
      responses: {
        200: z.custom<typeof singingSessions.$inferSelect & { metrics?: typeof sessionMetrics.$inferSelect; events?: typeof sessionEvents.$inferSelect[] }>(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      },
    },
    finish: {
      method: 'POST' as const,
      path: '/api/sessions/:id/finish',
      input: z.object({
        durationSec: z.number(),
        metrics: insertSessionMetricsSchema.omit({ sessionId: true }),
        events: z.array(insertSessionEventSchema.omit({ sessionId: true })).optional(),
      }),
      responses: {
        200: z.custom<typeof singingSessions.$inferSelect>(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      },
    },
  },
  progress: {
    get: {
      method: 'GET' as const,
      path: '/api/progress/summary',
      responses: {
        200: z.object({
          totalSessions: z.number(),
          totalDurationSec: z.number(),
          averageScore: z.number(),
          streakDays: z.number(),
          recentScores: z.array(z.object({
            date: z.string(),
            score: z.number(),
          })),
        }),
        401: errorSchemas.unauthorized,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
