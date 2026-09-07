// Initialize OpenTelemetry FIRST (patches http/express before they load). No-op
// unless OTEL is configured. See lib/tracing.ts.
import "./lib/tracing";
import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import auth from "./middleware/auth";
import { rateLimit } from "express-rate-limit";
import { createComponentLogger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { register as metricsRegister } from "./lib/promMetrics";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./lib/swagger";

// Import routes
import chatRoutes from "./routes/chatRoutes";
import messageRoutes from "./routes/messageRoutes";
import chatStreamRoutes from "./routes/chatStreamRoutes";
import usageRoutes from "./routes/usageRoutes";
import { getChatUsage } from "./controllers/usageController";

const log = createComponentLogger("server");

// Load environment variables
dotenv.config();

// Log environment variables at bootup
log.info(
  {
    log_level: process.env.LOG_LEVEL || "info",
    database_url: process.env.DATABASE_URL ? "[MASKED]" : "Not Set",
    cors_origin: process.env.CORS_ORIGIN || "*",
    port: process.env.PORT || 3000,
    node_env: process.env.NODE_ENV || "development",
    distillation_enabled: process.env.DISTILLATION_ENABLED || "false",
    distillation_service_url: process.env.DISTILLATION_SERVICE_URL || "Not Set",
    distillation_min_messages: process.env.DISTILLATION_MIN_MESSAGES || "10",
    distillation_min_interval_ms:
      process.env.DISTILLATION_MIN_INTERVAL_MS || "900000",
    ollama_base_url: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    ollama_model: process.env.OLLAMA_MODEL || "qwen3.5:2b",
    max_history_messages: process.env.MAX_HISTORY_MESSAGES || "20",
    admin_api_url: process.env.ADMIN_API_URL || "Not Set",
    portal_api_url: process.env.PORTAL_API_URL || "Not Set",
    memory_service_url: process.env.MEMORY_SERVICE_URL || "Not Set",
    memory_service_enabled: process.env.MEMORY_SERVICE_ENABLED || "false",
    memory_search_limit: process.env.MEMORY_SEARCH_LIMIT || "10",
  },
  "Environment variables",
);

// Initialize Express app
const app: Express = express();

// Trust the first proxy (e.g., Kubernetes Ingress, Nginx, etc.)
// This is required for express-rate-limit to work correctly behind a proxy
app.set("trust proxy", 1);

const PORT: number = Number(process.env.PORT) || 3000;

// Initialize Prisma client
const prisma = new PrismaClient();

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting to all requests
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Limit each IP to 10000 requests per windowMs
  message: "Too many requests from this IP, please try again after 15 minutes",
});
app.use(limiter);

// Prometheus metrics (scraped via the chart's prometheus.io/scrape annotation)
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

// Health check endpoint
// Moved before auth to ensure Kubernetes/Docker health checks pass without a token
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Interactive API docs (before auth so they need no token). Served in every environment:
// exposure is gated at the edge (Istio + oauth2-proxy), not by NODE_ENV, and neither path
// is routed externally. /openapi.json is read in-mesh by apidocs-api-server, which
// aggregates every service's spec at api.<domain>/v1/api-docs.
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/openapi.json", (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

app.use(auth);

// Make Prisma client available to routes
app.use((req: Request, res: Response, next: NextFunction) => {
  (req as any).prisma = prisma;
  next();
});

// Routes
app.use("/v1/chats", chatRoutes);
app.use("/v1/chats/:id/messages", messageRoutes);
// SSE streaming endpoint — must come before the generic chat routes
app.use("/v1/chats/:chatId/stream", chatStreamRoutes);
app.get("/v1/chats/:chatId/usage", getChatUsage);
app.use("/v1/usage", usageRoutes);

// 404 + global error handler (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(PORT, "0.0.0.0", () => {
  log.info(
    { port: PORT, node_env: process.env.NODE_ENV || "development" },
    "Server running",
  );
});

log.info("Server started successfully");

// Graceful shutdown
process.on("SIGTERM", async () => {
  log.info("SIGTERM received, shutting down gracefully");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  log.info("SIGINT received, shutting down gracefully");
  await prisma.$disconnect();
  process.exit(0);
});
