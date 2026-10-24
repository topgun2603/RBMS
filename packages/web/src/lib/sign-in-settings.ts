"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { SignInAudience, SignInMethod } from "./firebase-phone";
import { useTenantSlug } from "./tenant";

/** The methods a shop can switch on, in the order the settings page lists them. */
export const SIGN_IN_METHODS: readonly SignInMethod[] = ["sms", "whatsapp", "email_code", "google", "password"];

export interface AudienceOptions {
  /** Enabled methods, in display order. */
  methods: SignInMethod[];
  /** Shown first; always one of `methods`. */
  default: SignInMethod;
}
export interface SignInSettings {
  options: Record<SignInAudience, AudienceOptions>;
  defaults: Record<SignInAudience, AudienceOptions>;
  /** What the platform offers at all (SMS needs Firebase or an SMS provider, Google and password need Firebase). */
  platform: Record<SignInMethod, boolean>;
}

export const signInSettingsKey = (tenant: string | null | undefined) => ["auth", "settings", tenant ?? null] as const;

/** `GET /v1/auth/settings` (owner / admin). */
export function useSignInSettings(enabled = true) {
  const tenant = useTenantSlug();
  return useQuery({ queryKey: signInSettingsKey(tenant), queryFn: () => api.get<SignInSettings>("/auth/settings"), enabled });
}

/** `PUT /v1/auth/settings`: changes one or both audiences. */
export function useSaveSignInSettings() {
  const qc = useQueryClient();
  const tenant = useTenantSlug();
  return useMutation({
    mutationFn: (patch: Partial<Record<SignInAudience, AudienceOptions>>) => api.put<SignInSettings>("/auth/settings", patch),
    onSuccess: (data) => qc.setQueryData(signInSettingsKey(tenant), data),
  });
}

/**
 * Switches a method on or off. Returns the new options, or null when the change is not allowed: the last enabled method
 * stays on. Turning the preferred method off moves "shown first" to the first one left; a method turned on goes last.
 */
export function toggleMethod(opts: AudienceOptions, method: SignInMethod, on: boolean): AudienceOptions | null {
  const has = opts.methods.includes(method);
  if (on === has) return opts;
  if (on) return { methods: [...opts.methods, method], default: opts.default };
  const methods = opts.methods.filter((m) => m !== method);
  if (methods.length === 0) return null;
  return { methods, default: opts.default === method ? methods[0]! : opts.default };
}

/** Makes an enabled method the one shown first (the list order follows: it moves to the front). */
export function makeFirst(opts: AudienceOptions, method: SignInMethod): AudienceOptions {
  if (!opts.methods.includes(method)) return opts;
  return { methods: [method, ...opts.methods.filter((m) => m !== method)], default: method };
}

export const sameOptions = (a: AudienceOptions, b: AudienceOptions) =>
  a.default === b.default && a.methods.length === b.methods.length && a.methods.every((m, i) => m === b.methods[i]);

/** True when turning `method` off would leave nothing the platform can actually offer. */
export function isLastUsable(opts: AudienceOptions, method: SignInMethod, platform: Record<SignInMethod, boolean>): boolean {
  return !opts.methods.some((m) => m !== method && platform[m]);
}
