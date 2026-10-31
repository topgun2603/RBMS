"use client";

import * as React from "react";
import { api } from "@rbms/web";

/**
 * Online state for the counter: the browser's own flag plus "the API answered". A failed call reports
 * `reportNetwork(false)`; while the API is unreachable a light ping (GET /v1/features) runs every few seconds and
 * flips it back as soon as the server answers (the dev server restarts often).
 */

type Listener = () => void;
let apiReachable = true;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

export function reportNetwork(ok: boolean) {
  if (apiReachable === ok) return;
  apiReachable = ok;
  emit();
}

const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function useBrowserOnline(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export interface OnlineState {
  online: boolean;
  browserOnline: boolean;
  apiReachable: boolean;
}

export function useOnline(): OnlineState {
  const browserOnline = useBrowserOnline();
  const reachable = React.useSyncExternalStore(subscribe, () => apiReachable, () => true);

  React.useEffect(() => {
    if (reachable || !browserOnline) return;
    let stopped = false;
    const ping = async () => {
      try {
        await api.get("/features", undefined, { anonymous: true });
        if (!stopped) reportNetwork(true);
      } catch {
        // still down
      }
    };
    const id = window.setInterval(ping, 4000);
    void ping();
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [reachable, browserOnline]);

  return { online: browserOnline && reachable, browserOnline, apiReachable: reachable };
}
