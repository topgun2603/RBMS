"use client";

import * as React from "react";
import Link from "next/link";
import { RotateCcwIcon } from "lucide-react";
import { OfflineArt } from "../components/illustrations";
import { Button } from "@rbms/ui/components/button";
import { useStore } from "./store-context";

/** For app/error.tsx (rendered inside the store layout, so branding + strings are available). */
export function StoreErrorView({ reset }: { error?: Error & { digest?: string }; reset: () => void }) {
  const { t } = useStore();
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
      <span className="block w-56 text-primary sm:w-64">
        <OfflineArt className="sf-float" />
      </span>
      <h1 className="mt-6 font-display text-h1 font-semibold">{t("common.errorTitle")}</h1>
      <p className="mt-2 text-muted-foreground">{t("common.errorBody")}</p>
      <div className="mt-8 flex gap-3">
        <Button size="lg" className="rounded-full" onClick={reset}>
          <RotateCcwIcon />
          {t("common.retry")}
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link href="/">{t("common.backHome")}</Link>
        </Button>
      </div>
    </div>
  );
}
