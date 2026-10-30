"use client";

import * as React from "react";
import { RulerIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@rbms/ui/components/dialog";
import { useStore } from "./store-context";

/** "Size guide" link that opens a dialog with the shop's guide (server-rendered content passed in). */
export function SizeGuideButton({ children }: { children: React.ReactNode }) {
  const { t } = useStore();
  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-primary underline-offset-4 hover:underline focus-ring" data-testid="size-guide">
        <RulerIcon className="size-4" />
        {t("size.title")}
      </DialogTrigger>
      <DialogContent className="max-h-[88dvh] rounded-3xl p-6 sm:max-w-xl" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{t("size.title")}</DialogTitle>
          <DialogDescription>{t("size.subtitle")}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
