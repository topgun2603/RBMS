import { ProviderError } from "../types";

export type FetchFn = typeof fetch;

/** Sends a request and parses the JSON (or text) response; non-2xx responses throw ProviderError with status and body. */
export async function requestJson<T = unknown>(
  fetchFn: FetchFn,
  provider: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams },
): Promise<T> {
  const res = await fetchFn(url, { method: init.method ?? "POST", headers: init.headers, body: init.body });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep the raw text
  }
  if (!res.ok) throw new ProviderError(provider, res.status, body);
  return body as T;
}

/** "+91 98765-43210" → "919876543210" (providers want digits only, with country code). */
export const digitsOnly = (phone: string) => phone.replace(/\D/g, "");
