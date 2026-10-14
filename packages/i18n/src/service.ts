import type { Db } from "@srirealtime/db";
import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { en } from "./bundles/en";
import { ta } from "./bundles/ta";
import { createTranslator, DEFAULT_LOCALE, normalizeLocale, SUPPORTED_LOCALES, type Locale, type Messages, type Vars } from "./client";
import { buildDictionary } from "./dictionary";
import { i18nOverrides, type I18nOverride } from "./schema";

export const BUILT_IN_BUNDLES: Record<Locale, Messages> = { en, ta };

export interface MessagesScope {
  appId?: string | null;
  tenantId?: string | null;
}

export interface OverrideInput {
  /** null = app-wide override (platform level). */
  tenantId: string | null;
  /** null = applies to every app. */
  appId?: string | null;
  locale: string;
  key: string;
  value: string;
}

export type OverrideRef = Omit<OverrideInput, "value">;

export const overrideKeySchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/, "Invalid message key");
export const overrideValueSchema = z.string().max(2000);
export const localeSchema = z.enum(SUPPORTED_LOCALES);

export interface I18nServiceOptions {
  db: Db;
  bundles?: Partial<Record<Locale, Messages>>;
  cacheTtlMs?: number;
}

export class I18nService {
  private readonly db: Db;
  private readonly extra: Partial<Record<Locale, Messages>>;
  private readonly appMessages = new Map<string, Partial<Record<Locale, Messages>>>();
  private readonly cache = new Map<string, { value: Messages; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(opts: I18nServiceOptions) {
    this.db = opts.db;
    this.extra = opts.bundles ?? {};
    this.ttlMs = opts.cacheTtlMs ?? 30_000;
  }

  /** In-code per-app messages, merged over the built-in and extra bundles. */
  registerAppMessages(appId: string, locale: Locale, messages: Messages): void {
    const current = this.appMessages.get(appId) ?? {};
    current[locale] = { ...current[locale], ...messages };
    this.appMessages.set(appId, current);
    this.cache.clear();
  }

  /**
   * Merged dictionary. Precedence: built-in < extra bundles < app (code) < app (db, no tenant)
   * < tenant (db). English fills keys missing in other locales.
   */
  async messages(locale: string, scope: MessagesScope = {}): Promise<Messages> {
    const loc = normalizeLocale(locale);
    const appId = scope.appId ?? null;
    const tenantId = scope.tenantId ?? null;
    const key = `${tenantId ?? ""}|${appId ?? ""}|${loc}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const overrides = await this.loadOverrides(loc, appId, tenantId);
    const value = buildDictionary(loc, {
      base: [BUILT_IN_BUNDLES, this.extra, appId ? this.appMessages.get(appId) : undefined],
      overrides,
    });
    if (this.ttlMs > 0) this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  async t(key: string, opts: { locale: string; appId?: string | null; tenantId?: string | null; vars?: Vars }): Promise<string> {
    const loc = normalizeLocale(opts.locale);
    const dict = await this.messages(loc, opts);
    return createTranslator(dict, undefined, loc)(key, opts.vars);
  }

  async setOverride(input: OverrideInput): Promise<I18nOverride> {
    const locale = localeSchema.parse(input.locale);
    const key = overrideKeySchema.parse(input.key);
    const value = overrideValueSchema.parse(input.value);
    const tenantId = input.tenantId;
    const appId = input.appId ?? null;
    const [row] = await this.db
      .insert(i18nOverrides)
      .values({ tenantId, appId, locale, key, value })
      .onConflictDoUpdate({
        target: [i18nOverrides.tenantId, i18nOverrides.appId, i18nOverrides.locale, i18nOverrides.key],
        set: { value, updatedAt: new Date() },
      })
      .returning();
    this.invalidate(tenantId);
    return row!;
  }

  /** Returns true if an override was removed. */
  async removeOverride(ref: OverrideRef): Promise<boolean> {
    const locale = localeSchema.parse(ref.locale);
    const appId = ref.appId ?? null;
    const removed = await this.db
      .delete(i18nOverrides)
      .where(
        and(
          ref.tenantId ? eq(i18nOverrides.tenantId, ref.tenantId) : isNull(i18nOverrides.tenantId),
          appId ? eq(i18nOverrides.appId, appId) : isNull(i18nOverrides.appId),
          eq(i18nOverrides.locale, locale),
          eq(i18nOverrides.key, ref.key),
        ),
      )
      .returning({ id: i18nOverrides.id });
    this.invalidate(ref.tenantId);
    return removed.length > 0;
  }

  /** Overrides owned by a tenant (or app-wide ones when `tenantId` is null). */
  listOverrides(tenantId: string | null): Promise<I18nOverride[]> {
    return this.db
      .select()
      .from(i18nOverrides)
      .where(tenantId ? eq(i18nOverrides.tenantId, tenantId) : isNull(i18nOverrides.tenantId))
      .orderBy(asc(i18nOverrides.locale), asc(i18nOverrides.key));
  }

  private async loadOverrides(locale: Locale, appId: string | null, tenantId: string | null) {
    const locales = locale === DEFAULT_LOCALE ? [locale] : [locale, DEFAULT_LOCALE];
    const tenantFilter: SQL | undefined = tenantId
      ? or(isNull(i18nOverrides.tenantId), eq(i18nOverrides.tenantId, tenantId))
      : isNull(i18nOverrides.tenantId);
    const appFilter: SQL | undefined = appId ? or(isNull(i18nOverrides.appId), eq(i18nOverrides.appId, appId)) : isNull(i18nOverrides.appId);
    return this.db
      .select({
        tenantId: i18nOverrides.tenantId,
        appId: i18nOverrides.appId,
        locale: i18nOverrides.locale,
        key: i18nOverrides.key,
        value: i18nOverrides.value,
      })
      .from(i18nOverrides)
      .where(and(inArray(i18nOverrides.locale, locales), tenantFilter, appFilter));
  }

  private invalidate(tenantId: string | null) {
    if (!tenantId) return this.cache.clear();
    for (const k of this.cache.keys()) if (k.startsWith(`${tenantId}|`)) this.cache.delete(k);
  }
}
