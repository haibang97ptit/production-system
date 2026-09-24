import express, { Application } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { requestLogger } from './api/middlewares/requestLogger';
import { errorHandler, notFoundHandler } from './api/middlewares/errorHandler';
import {
  apiKeyAuth,
  createRateLimiter,
  securityHeaders,
} from './api/middlewares/security';
import { swaggerSpec } from './api/swagger';
import batchRoutes from './api/routes/batch.routes';
import machineRoutes from './api/routes/machine.routes';
import healthRoutes from './api/routes/health.routes';

export function createApp(): Application {
  const app = express();

  // Trust proxy để lấy đúng IP client khi chạy sau reverse proxy (nginx)
  app.set('trust proxy', 1);

  // Security headers
  app.use(securityHeaders);

  // CORS
  const corsOrigins =
    config.CORS_ORIGINS === '*'
      ? '*'
      : config.CORS_ORIGINS.split(',').map((s) => s.trim());
  app.use(
    cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-api-key'],
      credentials: false,
    })
  );

  app.use(express.json({ limit: '1mb' }));

  // Rate limit
  app.use(
    createRateLimiter(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_MINUTES)
  );

  // Request logging
  app.use(requestLogger);

  // Public routes (no auth)
  app.use('/api/health', healthRoutes);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/', (_req, res) =>
    res.json({
      name: 'Batch Report API',
      version: '1.0.0',
      docs: '/docs',
      health: '/api/health',
    })
  );

  // Protected routes (API key nếu config.API_KEY set)
  app.use('/api', apiKeyAuth);
  app.use('/api/batches', batchRoutes);
  app.use('/api/machines', machineRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
