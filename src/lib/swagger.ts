import swaggerJSDoc from "swagger-jsdoc";

/* eslint-disable @typescript-eslint/no-require-imports */
const pkg = require("../../package.json") as { version: string };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * OpenAPI spec built from @openapi JSDoc blocks on the route files.
 * Served at /api-docs in non-production (see index.ts).
 */
export const openApiSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "chatbot-api-server",
      version: pkg.version,
      description:
        "Legacy chatbot API for the bouc.io platform — chat sessions, messages, SSE " +
        "streaming, and usage. Superseded by agent-api-server.",
      license: {
        name: "Elastic-2.0",
        url: "https://www.elastic.co/licensing/elastic-license",
      },
    },
    servers: [{ url: "/", description: "Current host" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/routes/*.ts", "./dist/routes/*.js"],
});
