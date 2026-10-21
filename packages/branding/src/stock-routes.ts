import type { FastifyInstance } from "fastify";
import { isStockSlot, isStockTrade, stockArtSvg, stockColorsFromQuery } from "./stock-art";

/**
 * `GET /v1/branding/stock/:trade/:slot.svg?p=&a=&b=`: a stock picture in the given brand colours (hex without '#').
 * Public and tenant-free (the colours travel in the URL), so a store page and the editor can both load it as an
 * <img>. The SVG is generated, has no script and no external references; a strict CSP keeps it that way if it is
 * opened directly.
 */
export function stockArtRoutes() {
  return async (app: FastifyInstance) => {
    app.get("/stock/:trade/:file", async (req, reply) => {
      const { trade, file } = req.params as { trade: string; file: string };
      const slot = file.replace(/\.svg$/, "");
      if (!isStockTrade(trade) || !isStockSlot(slot) || !file.endsWith(".svg")) {
        return reply.code(404).send({ error: { code: "not_found", message: "Stock picture not found" } });
      }
      const q = req.query as { p?: string; a?: string; b?: string };
      const svg = stockArtSvg(trade, slot, stockColorsFromQuery(trade, q));
      reply.header("content-type", "image/svg+xml; charset=utf-8");
      reply.header("cache-control", "public, max-age=604800, immutable");
      reply.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      reply.header("x-content-type-options", "nosniff");
      reply.header("cross-origin-resource-policy", "cross-origin");
      return reply.send(svg);
    });
  };
}
