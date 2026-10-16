"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useFeature, useI18n } from "@srirealtime/web";
import { ChevronRightIcon, NotebookTabsIcon, PlusIcon, UsersRoundIcon } from "lucide-react";
import { Button, Card, cn, EmptyState, InitialsAvatar, Skeleton, Stagger, StaggerItem } from "@srirealtime/ui";
import { CustomerDialog } from "../components/customer-dialog";
import { PeopleIllustration } from "../components/illustrations";
import { BalancePill, balanceInk } from "../components/credit-book/credit-book-ui";
import { money } from "../lib/format";
import { useCustomers } from "../lib/queries";

export default function CustomersPage() {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [limit, setLimit] = React.useState(50);
  const debounced = useDebounced(q.trim(), 300);
  const list = useCustomers(debounced, limit);
  const [adding, setAdding] = React.useState(false);
  const creditBook = useFeature("invoices.credit-book");
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <Page>
      <PageHeading
        icon={UsersRoundIcon}
        title={t("billing.customers.title")}
        description={list.data ? t("billing.customers.count", { count: total }) : undefined}
        actions={
          <>
            {creditBook && (
              <Button asChild variant="outline" size="lg" className="h-11">
                <ModuleLink to="credit-book">
                  <NotebookTabsIcon /> {t("billing.creditBook.openCreditBook")}
                </ModuleLink>
              </Button>
            )}
            <Button size="lg" className="h-11" onClick={() => setAdding(true)}>
              <PlusIcon /> {t("billing.customers.add")}
            </Button>
          </>
        }
      />
      <SearchField value={q} onChange={setQ} placeholder={t("billing.customers.search")} className="mb-3" />

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card className="gap-0 divide-y py-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            </div>
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={<PeopleIllustration />}
          title={debounced ? t("billing.customers.noMatch") : t("billing.customers.emptyTitle")}
          description={debounced ? undefined : t("billing.customers.emptyBody")}
          action={
            <Button size="lg" className="h-11" onClick={() => setAdding(true)}>
              <PlusIcon /> {t("billing.customers.add")}
            </Button>
          }
        />
      ) : (
        <Card className={cn("gap-0 py-1 transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <Stagger key={debounced} className="divide-y px-1">
            {items.map((c) => (
              <StaggerItem key={c.id}>
                <ModuleLink
                  to={`customers/${c.id}`}
                  className="group flex min-h-16 items-center gap-3 rounded-xl px-3 py-2.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <InitialsAvatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="mt-0.5 truncate text-meta text-muted-foreground">
                      {[c.phone, c.gstin].filter(Boolean).join(" · ") || t("billing.picker.noDetails")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {c.outstanding !== 0 && (
                      <span className={cn("font-semibold tabular-nums", balanceInk(c.outstanding))}>{money(Math.abs(c.outstanding))}</span>
                    )}
                    <BalancePill balance={c.outstanding} />
                  </div>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                </ModuleLink>
              </StaggerItem>
            ))}
          </Stagger>
          {items.length < total && (
            <div className="flex justify-center p-3">
              <Button variant="ghost" onClick={() => setLimit((l) => Math.min(200, l + 50))} disabled={limit >= 200}>
                {t("billing.common.loadMore")}
              </Button>
            </div>
          )}
        </Card>
      )}

      <CustomerDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}
