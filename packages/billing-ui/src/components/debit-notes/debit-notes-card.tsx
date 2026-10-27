"use client";

import { FilePlus2Icon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@srirealtime/ui";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { money } from "../../lib/format";
import type { DebitNoteSummary } from "../../lib/types-debit-notes";
import { DebitNoteStatusPill } from "./debit-note-ui";

/** The bill's debit notes (issued and cancelled) with the create button; nothing when there are none and none can be made. */
export function DebitNotesCard({ notes, canCreate, onCreate }: { notes: DebitNoteSummary[]; canCreate: boolean; onCreate: () => void }) {
  const { t, formatDate } = useI18n();
  if (notes.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="icon-chip size-8 text-warning-ink">
            <FilePlus2Icon className="size-4" />
          </span>
          {t("billing.dn.bill.cardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative grid gap-1 before:absolute before:top-2 before:bottom-2 before:left-[0.4375rem] before:w-px before:bg-border">
          {notes.map((n) => (
            <li key={n.id} className="relative flex items-start gap-3 py-1.5 pl-5">
              <span aria-hidden className={n.status === "cancelled" ? "absolute top-3 left-0.5 size-2.5 rounded-full bg-muted-foreground/40" : "absolute top-3 left-0.5 size-2.5 rounded-full bg-warning"} />
              <ModuleLink to={`sales-debit-notes/${n.id}`} className="min-w-0 flex-1 rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                <span className="block font-medium tabular-nums">{n.number}</span>
                <span className="block text-meta text-muted-foreground">
                  {formatDate(n.date)} · {t(`billing.dn.reasons.${n.reason}`)}
                </span>
              </ModuleLink>
              <span className="flex flex-col items-end gap-1">
                <span className={n.status === "cancelled" ? "text-sm text-muted-foreground line-through tabular-nums" : "text-sm font-semibold tabular-nums"}>+{money(n.total)}</span>
                {n.status === "cancelled" && <DebitNoteStatusPill status={n.status} />}
              </span>
            </li>
          ))}
        </ol>
        {canCreate && (
          <Button variant="outline" className="mt-3 h-10 w-full" onClick={onCreate}>
            <FilePlus2Icon /> {t("billing.dn.createLong")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
