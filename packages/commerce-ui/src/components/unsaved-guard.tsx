"use client";

import * as React from "react";
import { ConfirmDialog, useAppNavigate, useI18n } from "@rbms/web";

/**
 * Unsaved-changes guard: while `when` is true, closing or reloading the tab asks the browser's own question, and
 * clicks on in-app links (sidebar, back links, breadcrumbs) open a "Discard changes?" dialog first.
 * Returns `confirmLeave(href)` for buttons that navigate programmatically.
 */
export function useUnsavedGuard(when: boolean) {
  const { t } = useI18n();
  const navigate = useAppNavigate();
  const [pending, setPending] = React.useState<string | null>(null);
  const bypass = React.useRef(false);

  React.useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypass.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Capture phase on window: runs before React's (and next/link's) click handlers.
    const onClick = (e: MouseEvent) => {
      if (bypass.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.noGuard !== undefined) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, [when]);

  /** Navigate now without asking (after a successful save). */
  const leave = React.useCallback(
    (href: string, opts?: { replace?: boolean }) => {
      bypass.current = true;
      navigate(href, opts);
      // The page usually unmounts; if it doesn't (same route), re-arm the guard.
      window.setTimeout(() => (bypass.current = false), 500);
    },
    [navigate],
  );

  const confirmLeave = React.useCallback(
    (href: string) => {
      if (when) setPending(href);
      else navigate(href);
    },
    [when, navigate],
  );

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
      title={t("commerce.unsaved.title")}
      description={t("commerce.unsaved.body")}
      confirmLabel={t("commerce.unsaved.discard")}
      onConfirm={() => {
        const href = pending;
        setPending(null);
        if (href) leave(href);
      }}
    />
  );

  return { dialog, confirmLeave, leave };
}
