"use client";

import * as React from "react";
import { cleanCode, createWedgeDetector } from "./scanner";
import { isEditable, shortcutFor, type ShortcutAction } from "./shortcuts";

export interface CounterKeysOptions {
  /** Off while a dialog/overlay owns the keyboard. */
  enabled: boolean;
  onScan: (code: string, target: EventTarget | null) => void;
  onShortcut: (action: ShortcutAction, e: KeyboardEvent) => void;
}

/**
 * One window keydown listener (capture phase) for the counter: feeds the scanner-wedge detector and maps function
 * keys / single keys to shortcuts. Scans are picked up anywhere on the screen, also inside the search box (fields
 * marked `data-scan-target`); other text fields are left alone so typing a price never triggers a scan.
 */
export function useCounterKeys({ enabled, onScan, onShortcut }: CounterKeysOptions) {
  const detector = React.useMemo(() => createWedgeDetector(), []);
  const handlers = React.useRef({ onScan, onShortcut });
  handlers.current = { onScan, onShortcut };

  React.useEffect(() => {
    if (!enabled) {
      detector.reset();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const editable = isEditable(e.target);
      const scanField = editable && (e.target as HTMLElement).closest?.("[data-scan-target]") !== null;
      if (!editable || scanField) {
        const code = detector.push({ key: e.key, time: e.timeStamp || performance.now() });
        if (code) {
          e.preventDefault();
          e.stopPropagation();
          const clean = cleanCode(code);
          if (clean) handlers.current.onScan(clean, e.target);
          return;
        }
      } else {
        detector.reset();
      }
      // Single-key shortcuts must not fire in the middle of a scan ("-" inside a code).
      if (e.key.length === 1 && detector.scanning) return;
      const action = shortcutFor({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, editable });
      if (!action) return;
      e.preventDefault();
      handlers.current.onShortcut(action, e);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled, detector]);
}

/** True on devices with a precise pointer (mouse): there we may keep the search box focused without popping a keyboard. */
export function useFinePointer(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(pointer: fine)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(pointer: fine)").matches,
    () => true,
  );
}

/** Media query hook (SSR-safe). */
export function useMediaQuery(query: string): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}
