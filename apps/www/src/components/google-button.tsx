"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { firebaseWebConfig, loadAuthConfig } from "@srirealtime/web/firebase-phone";
import { api } from "@/lib/api";
import { useSite } from "./site-context";

export const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

/** Google sign-in is offered when this site has the Firebase web config of the project the API verifies tokens for. */
export function useGoogleAvailable(): boolean {
  const [ok, setOk] = React.useState(false);
  React.useEffect(() => {
    const web = firebaseWebConfig();
    if (!web) return;
    let alive = true;
    void loadAuthConfig(api.authConfig).then((cfg) => {
      if (alive) setOk(cfg?.phone.method === "firebase" && cfg.phone.firebaseProjectId === web.projectId);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

/** "Continue with Google" + the "or use your mobile number" divider. */
export function GoogleButton({ busy, onClick, testId }: { busy: boolean; onClick: () => void; testId?: string }) {
  const { t } = useSite();
  return (
    <>
      <Button type="button" variant="outline" size="lg" className="w-full rounded-full" disabled={busy} onClick={onClick} data-testid={testId}>
        {busy ? <Loader2Icon className="animate-spin" /> : <GoogleG />}
        {busy ? t("ssi.googleBusy") : t("ssi.google")}
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("ssi.or")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}
