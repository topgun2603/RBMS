import { badRequest } from "@rbms/core";
import type { Db } from "@rbms/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantBranding } from "./schema";
import {
  brandTokensPatchSchema,
  brandTokensSchema,
  combinePatches,
  contrastWarnings,
  DEFAULT_BRAND_TOKENS,
  mergeTokens,
  toCssText,
  type BrandTokens,
  type BrandTokensPatch,
} from "./tokens";

export interface BrandingDeps {
  db: Db;
  /** Platform defaults applied under every tenant's overrides. */
  defaults?: Partial<BrandTokens>;
  /** App name shown when a tenant hasn't set one (and when there is no tenant). */
  defaultAppName?: string | null;
}

export interface Branding {
  appName: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  tokens: BrandTokens;
  css: string;
}

const assetUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Use an http(s) URL")
  .nullable()
  .optional();

export const brandingPatchSchema = z.object({
  appName: z.string().trim().min(1).max(80).nullable().optional(),
  logoUrl: assetUrl,
  logoDarkUrl: assetUrl,
  faviconUrl: assetUrl,
  tokens: brandTokensPatchSchema.optional(),
});

export type BrandingPatch = z.input<typeof brandingPatchSchema>;

export class BrandingService {
  private readonly db: Db;
  readonly defaults: BrandTokens;
  private readonly defaultAppName: string | null;

  constructor(deps: BrandingDeps) {
    this.db = deps.db;
    this.defaults = brandTokensSchema.parse({
      ...DEFAULT_BRAND_TOKENS,
      ...deps.defaults,
      colors: { ...DEFAULT_BRAND_TOKENS.colors, ...deps.defaults?.colors },
    });
    this.defaultAppName = deps.defaultAppName ?? null;
  }

  /** Platform branding, used when a request has no tenant. */
  platform(): Branding {
    return this.build(null, {});
  }

  async get(tenantId: string): Promise<Branding> {
    const [row] = await this.db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
    return this.build(row ?? null, row?.tokens ?? {});
  }

  /** Tokens for `tenantId` with `patch` applied, without saving. */
  async previewTokens(tenantId: string | null, patch: unknown): Promise<{ tokens: BrandTokens; css: string; warnings: string[] }> {
    const p = brandTokensPatchSchema.parse(patch);
    const base = tenantId ? (await this.get(tenantId)).tokens : this.defaults;
    const tokens = this.validate(mergeTokens(base, p));
    return { tokens, css: toCssText(tokens), warnings: contrastWarnings(tokens) };
  }

  async update(tenantId: string, patch: unknown): Promise<Branding & { warnings: string[] }> {
    const p = brandingPatchSchema.parse(patch);
    const [existing] = await this.db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
    const stored = combinePatches(existing?.tokens ?? {}, p.tokens);
    this.validate(mergeTokens(this.defaults, stored));

    const values = {
      appName: p.appName !== undefined ? p.appName : (existing?.appName ?? null),
      logoUrl: p.logoUrl !== undefined ? p.logoUrl : (existing?.logoUrl ?? null),
      logoDarkUrl: p.logoDarkUrl !== undefined ? p.logoDarkUrl : (existing?.logoDarkUrl ?? null),
      faviconUrl: p.faviconUrl !== undefined ? p.faviconUrl : (existing?.faviconUrl ?? null),
      tokens: stored,
    };
    const [row] = await this.db
      .insert(tenantBranding)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: tenantBranding.tenantId, set: { ...values, updatedAt: new Date() } })
      .returning();
    const branding = this.build(row!, stored);
    return { ...branding, warnings: contrastWarnings(branding.tokens) };
  }

  async reset(tenantId: string): Promise<Branding> {
    await this.db.delete(tenantBranding).where(eq(tenantBranding.tenantId, tenantId));
    return this.platform();
  }

  private validate(tokens: BrandTokens): BrandTokens {
    const parsed = brandTokensSchema.safeParse(tokens);
    if (!parsed.success) throw badRequest("Invalid branding tokens", parsed.error.issues);
    return parsed.data;
  }

  private build(
    row: { appName: string | null; logoUrl: string | null; logoDarkUrl: string | null; faviconUrl: string | null } | null,
    stored: BrandTokensPatch,
  ): Branding {
    const tokens = mergeTokens(this.defaults, stored);
    return {
      appName: row?.appName ?? this.defaultAppName,
      logoUrl: row?.logoUrl ?? null,
      logoDarkUrl: row?.logoDarkUrl ?? null,
      faviconUrl: row?.faviconUrl ?? null,
      tokens,
      css: toCssText(tokens),
    };
  }
}
