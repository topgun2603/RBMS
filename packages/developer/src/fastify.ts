declare module "fastify" {
  interface FastifyContextConfig {
    /** `false`: requests authenticated with an API key are refused (see `apiKeyGuard`). */
    apiKey?: boolean;
    /** Short description for the OpenAPI listing. */
    summary?: string;
  }
}

export {};
