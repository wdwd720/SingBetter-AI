import type { Request, Response } from "express";

export type ApiErrorPayload = {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, any> | string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, any> | string;

  constructor(status: number, code: string, message: string, details?: Record<string, any> | string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const getRequestId = (req: Request) =>
  typeof req.requestId === "string" && req.requestId.length > 0
    ? req.requestId
    : "unknown";

export const sendError = (
  res: Response,
  req: Request,
  status: number,
  code: string,
  message: string,
  details?: Record<string, any> | string
) =>
  res.status(status).json({
    code,
    message,
    requestId: getRequestId(req),
    ...(details ? { details } : {}),
  } satisfies ApiErrorPayload);
