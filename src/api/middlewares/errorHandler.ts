import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import { isProduction } from '../../config';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error(`API error: ${err.message}`, err);
  const body: { error: { message: string; stack?: string } } = {
    error: {
      message: isProduction ? 'Internal server error' : err.message,
    },
  };
  if (!isProduction && err.stack) {
    body.error.stack = err.stack;
  }
  res.status(500).json(body);
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { message: 'Route not found' } });
}
