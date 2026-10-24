"use client";

import { EyeIcon } from "lucide-react";
import { useOptionalSession } from "../app/session";
import { useI18n } from "../lib/i18n";

/** Platform role of the read-only live-demo accounts (apps/api demo-auth.ts). */
export const DEMO_PLATFORM_ROLE = "demo";

const GET_YOUR_OWN = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");

/** Strip at the top of the signed-in shell for demo sessions: the API refuses every write for them. */
export function DemoBanner() {
  const { t } = useI18n();
  const session = useOptionalSession();
  if (!session?.me.user.platformRoles.includes(DEMO_PLATFORM_ROLE)) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100 print:hidden">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <EyeIcon className="size-4" aria-hidden /> {t("web.demo.banner")}
      </span>
      <span>{t("web.demo.hint")}</span>
      {GET_YOUR_OWN && (
        <a href={`${GET_YOUR_OWN}/signup`} className="font-medium underline underline-offset-2">
          {t("web.demo.cta")}
        </a>
      )}
    </div>
  );
}
