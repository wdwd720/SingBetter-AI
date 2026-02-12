import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { AnyZodObject, ZodTypeAny } from "zod";

type ValidationSchema = {
  body?: ZodTypeAny;
  query?: AnyZodObject;
  params?: AnyZodObject;
};

export const validateRequest = (schema: ValidationSchema): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    const issues: string[] = [];

    if (schema.body) {
      const parsedBody = schema.body.safeParse(req.body);
      if (!parsedBody.success) {
        issues.push(...parsedBody.error.issues.map((issue) => issue.message));
      } else {
        req.body = parsedBody.data;
      }
    }

    if (schema.query) {
      const parsedQuery = schema.query.safeParse(req.query);
      if (!parsedQuery.success) {
        issues.push(...parsedQuery.error.issues.map((issue) => issue.message));
      } else {
        req.query = parsedQuery.data;
      }
    }

    if (schema.params) {
      const parsedParams = schema.params.safeParse(req.params);
      if (!parsedParams.success) {
        issues.push(...parsedParams.error.issues.map((issue) => issue.message));
      } else {
        req.params = parsedParams.data;
      }
    }

    if (issues.length > 0) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: issues[0],
        details: issues,
      });
      return;
    }

    next();
  };
};
