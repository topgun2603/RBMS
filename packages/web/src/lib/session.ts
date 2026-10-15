"use client";

import { useSyncExternalStore } from "react";

/**
 * localStorage keys shared by every srikit front end.
 * Storage is per origin, so every shop subdomain keeps its own sign-in.
 */
export const TOKEN_KEY = "sr_token";
export const LOCALE_KEY = "sr_locale";
export const SIDEBAR_KEY = "sr_sidebar_collapsed";
/** Shop slug for apps that pick the shop in the UI (tenant strategy { from: "storage" }). */
export const TENANT_KEY = "sr_tenant";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("sr_")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked (private mode); state just won't persist
  }
  emit();
}

export const getToken = () => readStored(TOKEN_KEY);
export const setToken = (token: string | null) => writeStored(TOKEN_KEY, token);

/** Reactive localStorage value; null during SSR and the hydration render. */
export function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
}

export const useToken = () => useStored(TOKEN_KEY);
export const getStoredTenant = () => readStored(TENANT_KEY);
export const setStoredTenant = (slug: string | null) => writeStored(TENANT_KEY, slug);

const noopSubscribe = () => () => {};
/** False on the server and during hydration, true afterwards. Gate localStorage-driven redirects on it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
