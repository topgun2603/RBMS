"use client";

import * as React from "react";
import { ArrowUpRightIcon, Loader2Icon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { useSite } from "./site-context";

/**
 * "Try the demo": asks the API for a read-only demo sign-in for this shop (POST /v1/auth/demo, through the same-origin
 * proxy) and opens the shop's app with the one-time handoff code. The tab is opened first, in the click, so pop-up
 * blockers allow it, then pointed at the app.
 */
export function TryDemoButton({ shop, name }: { shop: string; name: string }) {
  const { t } = useSite();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const res = await fetch("/api/v1/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shop }) });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !body?.url) throw new Error("demo_failed");
      if (tab) tab.location.href = body.url;
      else window.location.href = body.url;
    } catch {
      tab?.close();
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" onClick={go} disabled={busy} className="w-full rounded-full" aria-label={`${t("demo.apps.try")}: ${name}`} data-testid={`try-demo-${shop}`}>
        {busy ? <Loader2Icon className="animate-spin" /> : <ArrowUpRightIcon />}
        {busy ? t("demo.apps.opening") : t("demo.apps.try")}
      </Button>
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          {t("demo.apps.error")}
        </p>
      )}
    </div>
  );
}
