"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { SHORTCUTS } from "../lib/shortcuts";

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("pos.keys.title")}</DialogTitle>
          <DialogDescription>{t("pos.keys.body")}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.action} className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 odd:bg-muted/50">
              <dt className="text-sm">{t(s.description)}</dt>
              <dd>
                <kbd className="inline-flex min-w-10 justify-center rounded-md border border-b-2 bg-card px-2 py-1 font-mono text-xs font-semibold">{s.label}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{t("pos.keys.scanner")}</p>
      </DialogContent>
    </Dialog>
  );
}
