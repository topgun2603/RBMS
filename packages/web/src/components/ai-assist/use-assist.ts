"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useOptionalSession, usePermission } from "../../app/session";
import { api } from "../../lib/api";
import { useFeature } from "../../lib/features";
import { DEMO_PLATFORM_ROLE } from "../demo-banner";

/** The slice of GET /v1/ai/status the helpers read. */
export interface AiAssistStatus {
  ready: boolean;
  shopEnabled: boolean;
  mock: boolean;
  credits: { remaining: number | null };
  settings: { enabled: boolean; autoHsn?: boolean };
  features: { key: string; enabled: boolean }[];
}

/**
 * Whether the AI helpers should show at all for this person: a signed-in member with `ai.use`, the `ai` feature on for the
 * shop, not a read-only demo session (it can never spend credits). A shop that has not switched AI on still sees the
 * buttons: pressing one explains where the owner switches it on (the API answers `ai_off`).
 */
export function useAiAssistAllowed(extraPermission?: string | readonly string[]): boolean {
  const session = useOptionalSession();
  const featureOn = useFeature("ai");
  const canUse = usePermission("ai.use");
  const canExtra = usePermission(extraPermission);
  const demo = !!session?.me.user.platformRoles.includes(DEMO_PLATFORM_ROLE);
  return !!session && featureOn && canUse && !demo && (extraPermission === undefined || canExtra);
}

/** The shop's AI status (credits, per-helper switches, the "auto-suggest HSN" option). Only fetched when `enabled`. */
export function useAiAssistStatus(enabled = true) {
  const session = useOptionalSession();
  return useQuery<AiAssistStatus>({
    queryKey: ["ai", "status", "assist"],
    queryFn: () => api.get<AiAssistStatus>("/ai/status"),
    enabled: enabled && !!session,
    staleTime: 60_000,
    retry: false,
  });
}

/** True when the helper is switched on for the shop (so "auto" behaviours can run without an error toast). */
export function helperOn(status: AiAssistStatus | undefined, key: string): boolean {
  return !!status && status.settings.enabled && status.features.find((f) => f.key === key)?.enabled !== false;
}
