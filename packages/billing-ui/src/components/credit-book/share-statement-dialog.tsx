"use client";

import * as React from "react";
import { ExternalLinkIcon, Loader2Icon, MessageCircleIcon, Share2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FadeIn,
  Input,
  Label,
  toast,
} from "@srirealtime/ui";
import { CopyButton } from "../copy-button";
import { QrImage } from "../upi-qr";
import { describeError, useI18n, useOptionalShop } from "@srirealtime/web";
import { usePublicUrl } from "../../lib/links";
import { useShareStatement } from "../../lib/queries-v2";
import type { Customer } from "../../lib/types";
import { BalancePill, statementMessage, statementUrl, waLink } from "./credit-book-ui";

/** Creates the public statement link (POST statement/share), then offers copy, QR, WhatsApp and native share. */
export function ShareStatementDialog({
  customer,
  open,
  onOpenChange,
}: {
  customer: Pick<Customer, "id" | "name" | "phone" | "outstanding">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const shop = useOptionalShop();
  const shopName = shop?.shopName ?? "";
  const share = useShareStatement();
  const publicUrl = usePublicUrl();
  const [url, setUrl] = React.useState<string | null>(null);
  const [phone, setPhone] = React.useState("");

  const create = React.useCallback(() => {
    share.mutate(customer.id, {
      onSuccess: (r) => setUrl(statementUrl(r, publicUrl)),
      onError: (err) => toast.error(describeError(err, t)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate is stable enough; re-run per customer
  }, [customer.id]);

  React.useEffect(() => {
    if (!open) return;
    setPhone(customer.phone ?? "");
    if (!url) create();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when opened
  }, [open]);

  // A different customer means a different link.
  React.useEffect(() => setUrl(null), [customer.id]);

  const message = url ? statementMessage(t, { name: customer.name, shop: shopName, balance: customer.outstanding, url }) : "";
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.creditBook.statement.title")}</DialogTitle>
          <DialogDescription>{t("billing.creditBook.statement.body", { name: customer.name })}</DialogDescription>
        </DialogHeader>
        {!url ? (
          <div className="flex h-40 items-center justify-center">
            {share.isError ? (
              <Button variant="outline" size="lg" onClick={create}>
                {t("billing.common.retry")}
              </Button>
            ) : (
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden />
            )}
          </div>
        ) : (
          <FadeIn className="grid gap-4">
            <div className="flex items-center gap-4 rounded-2xl border bg-muted/40 p-3">
              <QrImage value={url} size={104} alt={t("billing.creditBook.statement.qrAlt")} className="border" />
              <div className="min-w-0 flex-1 space-y-2">
                <BalancePill balance={customer.outstanding} />
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={url}
                    className="h-11 font-mono text-xs"
                    onFocus={(e) => e.target.select()}
                    aria-label={t("billing.creditBook.statement.link")}
                  />
                  <CopyButton value={url} label={t("billing.share.copy")} copiedMessage={t("billing.share.copied")} className="size-11" />
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="statement-phone">{t("billing.share.whatsappTo")}</Label>
              <Input
                id="statement-phone"
                type="tel"
                inputMode="tel"
                className="h-11"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <Button asChild size="lg" className="h-12 bg-[#25D366] text-base text-white hover:bg-[#1ebe5b]">
              <a href={waLink(phone, message)} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon /> {t("billing.share.whatsapp")}
              </a>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              {canNativeShare && (
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11"
                  onClick={() =>
                    void navigator
                      .share({ title: t("billing.creditBook.statement.shareTitle", { shop: shopName }), text: message, url })
                      .catch(() => undefined)
                  }
                >
                  <Share2Icon /> {t("billing.share.more")}
                </Button>
              )}
              <Button asChild variant="outline" size="lg" className={canNativeShare ? "h-11" : "col-span-2 h-11"}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon /> {t("billing.share.open")}
                </a>
              </Button>
            </div>
          </FadeIn>
        )}
      </DialogContent>
    </Dialog>
  );
}
