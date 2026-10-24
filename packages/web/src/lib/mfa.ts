"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { SignInResponse } from "./types";

/** `GET /v1/auth/mfa`: the signed-in user's two-factor state. */
export interface MfaStatus {
  /** False when the platform has no two-factor secret configured. */
  available: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

/** Instead of a session, when step 1 of sign-in passed but the account needs the second step. */
export interface MfaRequiredResponse {
  mfa_required: true;
  /** The shop requires two-factor and this user has not set it up yet: enrol first. */
  enrolRequired: boolean;
  challengeToken: string;
  expiresAt: string;
}

export const isMfaRequired = (r: SignInResponse | MfaRequiredResponse): r is MfaRequiredResponse => "mfa_required" in r && r.mfa_required === true;

export interface MfaEnrolStart {
  secret: string;
  otpauthUri: string;
}

export const mfaStatusKey = ["auth", "mfa"] as const;

export function useMfaStatus() {
  return useQuery({ queryKey: mfaStatusKey, queryFn: () => api.get<MfaStatus>("/auth/mfa"), staleTime: 30_000 });
}

export const startMfaEnrol = (challengeToken?: string) =>
  api.post<MfaEnrolStart>("/auth/mfa/enrol/start", challengeToken ? { challengeToken } : {}, challengeToken ? { anonymous: true } : undefined);

export const confirmMfaEnrol = (code: string, challengeToken?: string) =>
  api.post<{ recoveryCodes: string[] } & Partial<SignInResponse>>(
    "/auth/mfa/enrol/confirm",
    challengeToken ? { code, challengeToken } : { code },
    challengeToken ? { anonymous: true } : undefined,
  );

export const verifyMfaSignIn = (challengeToken: string, code: string) =>
  api.post<SignInResponse>("/auth/mfa/verify", { challengeToken, code }, { anonymous: true });

export function useDisableMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post<{ ok: true }>("/auth/mfa/disable", { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mfaStatusKey }),
  });
}

export function useRegenerateRecoveryCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mfaStatusKey }),
  });
}

/** Recovery codes as a downloadable text file body. */
export const recoveryCodesText = (codes: string[], shop: string) =>
  `${shop}: two-factor recovery codes\nEach code works once.\n\n${codes.join("\n")}\n`;
