"use client";

import * as React from "react";
import { Loader2Icon, BanknoteIcon } from "lucide-react";
import { Button, DropdownMenuItem, toast } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { posApi } from "../lib/api";
import { failureKey, kickDrawer, useDeviceConfig } from "../lib/printing";
import { usePos } from "./pos-context";

/**
 * "No sale / open drawer": pulses the cash drawer through the direct printer. Only shown when this device has a direct
 * printer and the cashier holds the till permission (open and close the POS cash drawer). Each press is
 * logged on this device (lib/log in @srirealtime/receipt-print); there is no server audit entry yet (docs/printing.md).
 */
export function useNoSale() {
  const { t } = useI18n();
  const { tenant, cashier, can } = usePos();
  const [device] = useDeviceConfig(tenant);
  const [busy, setBusy] = React.useState(false);
  const available = can.till && !!device.transport && device.transport !== "none";
  const open = React.useCallback(async () => {
    setBusy(true);
    try {
      const r = await kickDrawer({ tenant, kind: "no_sale", user: cashier, interactive: true });
      if (r.opened) {
        toast.success(t("pos.drawer.opened"));
        // Unusual-activity alerts count no-sale opens (AI Phase 5 part A); a failure here never matters to the cashier.
        void posApi.post("/ai/counter/voice/no-sale", {}).catch(() => undefined);
      }
      else toast.error(t(failureKey(r.reason)));
    } finally {
      setBusy(false);
    }
  }, [tenant, cashier, t]);
  return { available, busy, open };
}

export function NoSaleButton() {
  const { t } = useI18n();
  const { available, busy, open } = useNoSale();
  if (!available) return null;
  return (
    <Button type="button" variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => void open()} disabled={busy} title={t("pos.drawer.title")}>
      {busy ? <Loader2Icon className="animate-spin" /> : <BanknoteIcon />} {t("pos.drawer.noSale")}
    </Button>
  );
}

export function NoSaleMenuItem() {
  const { t } = useI18n();
  const { available, busy, open } = useNoSale();
  if (!available) return null;
  return (
    <DropdownMenuItem disabled={busy} onSelect={() => void open()}>
      <BanknoteIcon /> {t("pos.drawer.noSale")}
    </DropdownMenuItem>
  );
}
