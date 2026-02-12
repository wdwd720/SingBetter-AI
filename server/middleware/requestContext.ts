import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && incoming.trim().length > 0
      ? incoming
      : randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}
