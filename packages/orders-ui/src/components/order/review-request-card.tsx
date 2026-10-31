"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2Icon, Loader2Icon, MessageSquareHeartIcon, SendIcon } from "lucide-react";
import { Button, toast } from "@rbms/ui";
import { api, describeError, useFeature, useI18n } from "@rbms/web";
import { usePermissions } from "../../lib/access";
import type { Order } from "../../lib/types";
import { Section } from "../bits";

interface RequestResult {
  status: "sent" | "skipped";
  reason?: string;
  channels: string[];
}

/**
 * "Ask for a review" on a delivered order: sends the customer the `review.request` message (WhatsApp / SMS / email
 * per the shop's message settings) with a link to write a review. Once per order; a signed-in buyer's review is
 * marked "Verified purchase" by the store itself.
 */
export function ReviewRequestCard({ order }: { order: Order }) {
  const { t } = useI18n();
  const reviews = useFeature("reviews");
  const { can } = usePermissions();
  const [done, setDone] = React.useState<RequestResult | null>(null);
  const send = useMutation({ mutationFn: () => api.post<RequestResult>("/reviews/requests", { orderId: order.id }) });
  if (!reviews || order.status !== "delivered" || !can("reviews.manage")) return null;
  const hasContact = !!(order.customer.phone || order.customer.email);

  const ask = async () => {
    try {
      const r = await send.mutateAsync();
      setDone(r);
      if (r.status === "sent") toast.success(t("orders.reviewRequest.sent"));
      else toast.info(t(`orders.reviewRequest.skipped.${r.reason === "duplicate" || r.reason === "off" || r.reason === "opted_out" || r.reason === "no_contact" ? r.reason : "other"}`));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const asked = done?.status === "sent" || done?.reason === "duplicate";
  return (
    <Section icon={MessageSquareHeartIcon} title={t("orders.reviewRequest.title")} description={t("orders.reviewRequest.body")}>
      {asked ? (
        <p className="flex items-center gap-2 text-sm text-success-ink">
          <CheckCircle2Icon className="size-4" /> {done?.status === "sent" ? t("orders.reviewRequest.sentNote") : t("orders.reviewRequest.skipped.duplicate")}
        </p>
      ) : (
        <Button variant="outline" disabled={send.isPending || !hasContact} onClick={() => void ask()}>
          {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("orders.reviewRequest.action")}
        </Button>
      )}
      {!hasContact && <p className="mt-2 text-meta text-muted-foreground">{t("orders.reviewRequest.skipped.no_contact")}</p>}
    </Section>
  );
}
