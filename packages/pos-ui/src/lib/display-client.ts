"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUrl } from "@rbms/web";
import { createSseParser, displayChannelName, readDisplayState, sameDisplay, type DisplayState } from "./display";
import { readJson, storageKey, writeJson } from "./storage";

/**
 * The customer display, counter side and screen side (docs/counter-close-display-labels.md).
 *
 * Counter: every change of the bill goes to a BroadcastChannel (a display tab on the same PC needs no setup) and, when
 * a screen is paired to this register, to the server (`PUT /pos/display/state`), which streams it to the screen.
 * Screen: pairs with a 6-digit code, keeps the display token in this browser, and reads the register's feed with fetch.
 */

const POS = "/pos";
export const DISPLAY_TOKEN_HEADER = "x-display-token";

export interface DisplayView {
  id: string;
  name: string;
  register: string;
  paired: boolean;
  pairingPending: boolean;
  pairedAt: string | null;
  lastSeenAt: string | null;
  settings: { language?: "auto" | "en" | "ta"; slideSeconds?: number };
}

export interface DisplayPairing {
  code: string;
  expiresAt: string;
}

export interface DisplayBrand {
  name: string | null;
  logoUrl: string | null;
  primary: string | null;
}

export interface DisplayConfig {
  display: { id: string; name: string; register: string; settings: DisplayView["settings"] };
  shop: DisplayBrand;
  messages: { welcomeEn: string; welcomeTa: string; offerEn: string; offerTa: string };
  slides: { name: string; image: string; price: number; mrp: number | null }[];
}

export const displayKeys = { list: (register: string) => ["pos", "displays", register.toLowerCase()] as const };

// ---------------------------------------------------------------- counter: screens of this register

export function useDisplays(register: string, enabled: boolean) {
  return useQuery({
    queryKey: displayKeys.list(register),
    queryFn: () => api<{ items: DisplayView[] }>(`${POS}/displays`, { query: { register } }).then((r) => r.items),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
    retry: 0,
  });
}

export function useDisplayActions(register: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: displayKeys.list(register) });
  const create = useMutation({
    mutationFn: (b: { name: string }) => api<{ display: DisplayView; pairing: DisplayPairing }>(`${POS}/displays`, { method: "POST", body: { name: b.name, register } }),
    onSuccess: refresh,
  });
  const newCode = useMutation({
    mutationFn: (id: string) => api<DisplayPairing>(`${POS}/displays/${id}/code`, { method: "POST" }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`${POS}/displays/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  return { create, newCode, revoke };
}

/**
 * Sends the bill state to the screens. Same-PC tabs get every change at once through a BroadcastChannel (and answer
 * `hello` from a tab that has just opened); paired screens get it from the server, at most about 6 times a second,
 * and only when it differs from the last one sent. Failures are ignored: the screen is a courtesy, never a blocker.
 */
export function useCustomerDisplay(opts: { tenant: string | null; register: string; remote: boolean; state: DisplayState }) {
  const { tenant, register, remote, state } = opts;
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const lastSent = React.useRef<DisplayState | null>(null);
  const timer = React.useRef<number | null>(null);
  const channel = React.useRef<BroadcastChannel | null>(null);

  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(displayChannelName(tenant, register));
    channel.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "hello") ch.postMessage({ type: "state", state: stateRef.current });
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [tenant, register]);

  const push = React.useCallback(() => {
    timer.current = null;
    const s = stateRef.current;
    if (sameDisplay(lastSent.current, s)) return;
    lastSent.current = s;
    api(`${POS}/display/state`, { method: "PUT", body: { register, state: s } }).catch(() => {
      // The next change sends it again.
      lastSent.current = null;
    });
  }, [register]);

  React.useEffect(() => {
    channel.current?.postMessage({ type: "state", state });
    if (!remote) return;
    if (timer.current === null) timer.current = window.setTimeout(push, 160);
  }, [state, remote, push]);

  // A screen paired while the bill is already on: send what is showing now.
  React.useEffect(() => {
    if (remote) {
      lastSent.current = null;
      push();
    }
  }, [remote, push]);

  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
}

// ---------------------------------------------------------------- screen: pairing and feed

export const displayTokenKey = (tenant: string | null | undefined) => storageKey("display-token", tenant ?? null);
export const readDisplayToken = (tenant: string | null | undefined) => readJson<string | null>(displayTokenKey(tenant), null);
export const writeDisplayToken = (tenant: string | null | undefined, token: string | null) => writeJson(displayTokenKey(tenant), token);

export class DisplayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`display request failed (${status})`);
  }
}

async function failure(res: Response): Promise<DisplayHttpError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  return new DisplayHttpError(res.status, body?.error?.code ?? null);
}

/** Trades the 6-digit code for the screen's token. */
export async function pairDisplay(code: string): Promise<{ token: string; display: DisplayView; shop: DisplayBrand }> {
  const res = await fetch(apiUrl(`${POS}/display/pair`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  if (!res.ok) throw await failure(res);
  return res.json();
}

export async function fetchDisplayConfig(token: string): Promise<DisplayConfig> {
  const res = await fetch(apiUrl(`${POS}/display/config`), { headers: { [DISPLAY_TOKEN_HEADER]: token } });
  if (!res.ok) throw await failure(res);
  return res.json();
}

/** Opens the register's feed; resolves when the stream ends, rejects with a `DisplayHttpError` when refused. */
export async function readDisplayFeed(token: string, onMessage: (m: { event: string; data: string }) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(apiUrl(`${POS}/display/stream`), { headers: { [DISPLAY_TOKEN_HEADER]: token, accept: "text/event-stream" }, signal });
  if (!res.ok || !res.body) throw await failure(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    for (const m of parse(decoder.decode(value, { stream: true }))) onMessage(m);
  }
}

/** A state message from the feed or the channel. */
export const stateFromMessage = (data: string) => readDisplayState(data);
