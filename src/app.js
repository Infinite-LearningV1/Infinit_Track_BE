import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';

import config from './config/index.js';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { requestLogger } from './middlewares/requestLogger.js';
import {
  securityHeaders,
  additionalSecurity,
  basicRateLimit,
  validateCorsOrigin
} from './middlewares/security.js';

const app = express();

// Validate CORS configuration on startup
validateCorsOrigin();

// Security headers (apply early)
app.use(securityHeaders);
app.use(additionalSecurity);

// Rate limiting (production only)
app.use(basicRateLimit);

// Request logging middleware (after security, before routes)
app.use(requestLogger);

// CORS configuration
app.use(
  cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 86400 // 24 hours
  })
);

// Body parsing middlewares
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use('/uploads', express.static('uploads'));

// Swagger documentation
const swaggerDoc = YAML.load('./docs/openapi.yaml');
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

app.use(routes);
app.use(errorHandler);

export default app;
