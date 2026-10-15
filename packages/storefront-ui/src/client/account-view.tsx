"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, GiftIcon, HeartIcon, Loader2Icon, LogOutIcon, MapPinIcon, PackageIcon, PlusIcon, Trash2Icon, UserRoundIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@srirealtime/ui/components/tabs";
import { AnimatePresence, motion } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { formatDate, money, prettyPhone } from "../lib/format";
import type { Address, List, Me, Order, OrderSummary, WishlistItem } from "../types";
import { Empty, StatusChip, StoreImage } from "../components/bits";
import { EmptyWishlistArt, NoOrdersArt } from "../components/illustrations";
import { AccountSkeleton } from "../components/skeletons";
import { call, errorMessage } from "./api";
import { AddressForm, AddressText } from "./address-form";
import { OtpSignIn } from "./sign-in";
import { useStore } from "./store-context";
import { ChatAboutOrder } from "./help-center";
import { LoyaltyPanel } from "./loyalty";
import { featureOn, STORE_FEATURES } from "../lib/features";

const ALL_TABS = ["orders", "points", "addresses", "wishlist", "profile"] as const;
type Tab = (typeof ALL_TABS)[number];
const ICONS: Record<Tab, React.ComponentType<{ className?: string }>> = { orders: PackageIcon, points: GiftIcon, addresses: MapPinIcon, wishlist: HeartIcon, profile: UserRoundIcon };
/** Tab label keys (`points` belongs to the loyalty module). */
const TAB_LABEL: Record<Tab, string> = { orders: "account.orders", points: "loyalty.tab", addresses: "account.addresses", wishlist: "account.wishlist", profile: "account.profile" };

/** `params` come from the server page (no useSearchParams, so no Suspense boundary that could hydrate after sign-in state loads). */
export function AccountView({ params }: { params: { tab?: string; order?: string; next?: string } }) {
  const { t, auth, shell } = useStore();
  const router = useRouter();
  const next = params.next ?? null;
  const TABS = ALL_TABS.filter((k) => k !== "points" || featureOn(shell.features, STORE_FEATURES.loyalty));
  const tab = (TABS as readonly string[]).includes(params.tab ?? "") ? (params.tab as Tab) : "orders";
  const orderId = params.order ?? null;
  const me = useQuery({ queryKey: ["me"], queryFn: () => call<Me>("/store/me"), enabled: !!auth.token });

  if (!auth.ready) return <AccountSkeleton bare />;
  if (!auth.token) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="kolam mx-auto max-w-md rounded-3xl border bg-card p-6 shadow-[var(--elevation-1)] sm:p-8">
        <OtpSignIn onSignedIn={() => next && /^\/(?!\/)/.test(next) && router.push(next)} />
      </motion.div>
    );
  }
  const name = me.data?.customer.name || auth.user?.name || prettyPhone(auth.user?.phone) || "";
  const go = (k: Tab) => router.push(`/account?tab=${k}`, { scroll: false });

  return (
    <Tabs value={tab} onValueChange={(v) => go(v as Tab)} orientation="vertical" className="grid gap-8 lg:grid-cols-[240px_1fr] lg:gap-12">
      <aside className="grid min-w-0 content-start gap-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-[image:var(--sf-gradient)] font-display text-xl font-semibold text-primary-foreground shadow-md shadow-primary/25">
            {(name || "?").trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{t("account.title")}</p>
            <p className="truncate font-display text-2xl font-semibold">{name ? t("account.hello", { name }) : t("account.title")}</p>
          </div>
        </div>
        {me.data && <p className="-mt-2 text-sm text-muted-foreground">{t("account.orderCount", { count: me.data.counts.orders })}</p>}
        <TabsList
          aria-label={t("account.title")}
          className="-mx-4 flex h-auto w-auto justify-start gap-1 overflow-x-auto rounded-none bg-transparent px-4 pb-1 scrollbar-none lg:mx-0 lg:flex-col lg:items-stretch lg:px-0"
        >
          {TABS.map((k) => {
            const Icon = ICONS[k];
            return (
              <TabsTrigger
                key={k}
                value={k}
                className="relative h-10 flex-none shrink-0 justify-start gap-2.5 rounded-full border-0 px-4 text-sm font-medium text-foreground/75 shadow-none hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none lg:rounded-xl dark:data-[state=active]:bg-transparent"
              >
                {tab === k && (
                  <>
                    <motion.span layoutId="acct-tab-pill" className="absolute inset-0 hidden rounded-xl bg-primary/10 lg:block" transition={{ type: "spring", stiffness: 420, damping: 36 }} />
                    <motion.span layoutId="acct-tab-line" className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-primary lg:hidden" transition={{ type: "spring", stiffness: 420, damping: 36 }} />
                  </>
                )}
                <Icon className="relative size-4" />
                <span className="relative">{t(TAB_LABEL[k])}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
        <button type="button" onClick={() => void auth.signOut()} className="flex h-10 w-fit items-center gap-2.5 rounded-full px-4 text-sm font-medium text-muted-foreground hover:bg-accent focus-ring lg:mt-2 lg:rounded-xl">
          <LogOutIcon className="size-4" />
          {t("auth.signOut")}
        </button>
      </aside>
      <div className="min-w-0">
        {TABS.map((k) => (
          <TabsContent key={k} value={k} className="mt-0">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
              {k === "orders" && (orderId ? <OrderDetail id={orderId} /> : <Orders />)}
              {k === "points" && <LoyaltyPanel />}
              {k === "addresses" && <Addresses />}
              {k === "wishlist" && <Wishlist />}
              {k === "profile" && (me.data ? <Profile me={me.data} /> : <div className="sf-shimmer h-60 rounded-3xl" />)}
            </motion.div>
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}

function Orders() {
  const { t, locale } = useStore();
  const q = useQuery({ queryKey: ["orders"], queryFn: () => call<List<OrderSummary>>("/store/me/orders", { query: { limit: 50 } }) });
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <p className="text-sm text-danger-ink">{errorMessage(q.error, t)}</p>;
  const items = q.data?.items ?? [];
  if (!items.length)
    return (
      <Empty
        illustration={<NoOrdersArt />}
        title={t("account.noOrders")}
        action={
          <Button asChild className="rounded-full">
            <Link href={STORE_PATHS.products}>{t("cart.startShopping")}</Link>
          </Button>
        }
      />
    );
  return (
    <ul className="grid gap-3" data-testid="orders-list">
      {items.map((o, i) => (
        <motion.li key={o.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}>
          <Link href={`/account?tab=orders&order=${o.id}`} scroll={false} className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-card focus-ring">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <PackageIcon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{o.number}</span>
              <span className="block text-xs text-muted-foreground">
                {formatDate(o.placedAt, locale)} · {t("cart.items", { count: o.itemCount })}
              </span>
            </span>
            <span className="hidden sm:block">
              <StatusChip status={o.status} label={t(`order.status.${o.status}`)} />
            </span>
            <span className="font-semibold tabular-nums">{money(o.total)}</span>
            <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </Link>
        </motion.li>
      ))}
    </ul>
  );
}

function OrderDetail({ id }: { id: string }) {
  const { t, locale, shell } = useStore();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["order", id], queryFn: () => call<Order>(`/store/me/orders/${id}`) });
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const cancel = useMutation({
    mutationFn: () => call<Order>(`/store/me/orders/${id}/cancel`, { body: { reason: reason.trim() } }),
    onSuccess: (o) => {
      qc.setQueryData(["order", id], o);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      setCancelling(false);
      toast.success(t("order.cancelled"));
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });
  if (q.isLoading) return <ListSkeleton />;
  if (!q.data) return <p className="text-sm text-danger-ink">{t("order.notFound")}</p>;
  const o = q.data;
  const canCancel = o.status === "placed" || o.status === "confirmed";
  return (
    <div className="grid gap-5">
      <Link href="/account?tab=orders" scroll={false} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
        <ChevronLeftIcon className="size-4" />
        {t("account.back")}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">{o.number}</h2>
          <p className="text-sm text-muted-foreground">{formatDate(o.placedAt, locale, { dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
        <div className="flex gap-2">
          <StatusChip status={o.status} label={t(`order.status.${o.status}`)} />
          <StatusChip status={o.paymentStatus} label={t(`order.payment.${o.paymentStatus}`)} />
        </div>
      </div>
      <ul className="divide-y rounded-2xl border bg-card px-4">
        {o.lines.map((l, i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
              <StoreImage src={l.image} alt={l.name} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium">{l.name}</span>
              <span className="text-xs text-muted-foreground">
                {l.qty} × {money(l.price)}
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums">{money(l.total)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid gap-1.5 rounded-2xl border bg-card p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("cart.subtotal")}</dt>
          <dd className="tabular-nums">{money(o.totals.subtotal)}</dd>
        </div>
        {o.totals.discount > 0 && (
          <div className="flex justify-between text-success-ink">
            <dt>{t("cart.discount")}</dt>
            <dd className="tabular-nums">−{money(o.totals.discount)}</dd>
          </div>
        )}
        {o.totals.loyalty && o.totals.loyalty.discount > 0 && (
          <div className="flex justify-between text-success-ink" data-testid="order-points">
            <dt>{t("loyalty.discountRow", { points: o.totals.loyalty.points })}</dt>
            <dd className="tabular-nums">−{money(o.totals.loyalty.discount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("cart.shipping")}</dt>
          <dd className="tabular-nums">{o.totals.shipping ? money(o.totals.shipping) : t("delivery.free")}</dd>
        </div>
        {o.totals.codFee ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("order.codFee")}</dt>
            <dd className="tabular-nums">{money(o.totals.codFee)}</dd>
          </div>
        ) : null}
        <div className="mt-1 flex justify-between border-t pt-2 font-semibold">
          <dt>{t("cart.total")}</dt>
          <dd className="tabular-nums">{money(o.totals.total)}</dd>
        </div>
      </dl>
      {o.cancelReason && <p className="text-sm text-muted-foreground">{t("order.cancelReasonLabel", { reason: o.cancelReason })}</p>}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="rounded-full">
          <Link href={`/track/${o.accessToken}`}>{t("order.track")}</Link>
        </Button>
        <ChatAboutOrder order={{ id: o.id, number: o.number, status: o.status, total: o.totals.total, image: o.lines[0]?.image ?? null, itemCount: o.lines.reduce((n, l) => n + l.qty, 0) }} />
        {featureOn(shell.features, STORE_FEATURES.support) && (
          <Button asChild variant="ghost" className="rounded-full">
            <Link href={`/help/new?order=${o.id}`}>{t("help.raise")}</Link>
          </Button>
        )}
        {canCancel && !cancelling && (
          <Button variant="ghost" className="rounded-full text-danger-ink hover:text-danger-ink" onClick={() => setCancelling(true)}>
            {t("order.cancel")}
          </Button>
        )}
      </div>
      {cancelling && (
        <form
          className="grid gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) cancel.mutate();
          }}
        >
          <label htmlFor="cancel-reason" className="text-sm font-medium">
            {t("order.cancelReason")}
          </label>
          <textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required maxLength={500} className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-[3px] focus:ring-ring/30" />
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" className="rounded-full" disabled={cancel.isPending || !reason.trim()}>
              {cancel.isPending && <Loader2Icon className="animate-spin" />}
              {t("order.cancelConfirm")}
            </Button>
            <Button type="button" variant="ghost" className="rounded-full" onClick={() => setCancelling(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Addresses() {
  const { t } = useStore();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["addresses"], queryFn: () => call<List<Address>>("/store/me/addresses") });
  const [editing, setEditing] = React.useState<Address | "new" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["addresses"] });
  if (q.isLoading) return <ListSkeleton />;
  const items = q.data?.items ?? [];
  if (editing) {
    return (
      <div className="rounded-3xl border bg-card p-5 sm:p-6">
        <AddressForm
          existing={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {items.length === 0 && <Empty icon={<MapPinIcon />} title={t("address.none")} />}
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((a) => (
          <li key={a.id} className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-4", a.isDefault && "border-primary/50")}>
            <div className="flex items-center gap-2">
              {a.label && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase">{a.label}</span>}
              {a.isDefault && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary uppercase">{t("address.default")}</span>}
            </div>
            <AddressText a={a} />
            <div className="mt-auto flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setEditing(a)}>
                {t("address.edit")}
              </Button>
              {!a.isDefault && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={async () => {
                    await call(`/store/me/addresses/${a.id}/default`, { method: "POST" }).catch((err) => toast.error(errorMessage(err, t)));
                    void refresh();
                  }}
                >
                  {t("address.makeDefault")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ms-auto rounded-full text-danger-ink hover:text-danger-ink"
                aria-label={t("address.delete")}
                onClick={async () => {
                  if (!window.confirm(t("address.confirmDelete"))) return;
                  await call(`/store/me/addresses/${a.id}`, { method: "DELETE" }).catch((err) => toast.error(errorMessage(err, t)));
                  void refresh();
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="outline" className="justify-self-start rounded-full" onClick={() => setEditing("new")}>
        <PlusIcon />
        {t("checkout.addAddress")}
      </Button>
    </div>
  );
}

function Wishlist() {
  const { t, cart } = useStore();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wishlist"], queryFn: () => call<List<WishlistItem>>("/store/me/wishlist") });
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <Empty illustration={<EmptyWishlistArt />} title={t("account.noWishlist")} />;
  const items = q.data?.items ?? [];
  if (!items.length)
    return (
      <Empty
        illustration={<EmptyWishlistArt />}
        title={t("account.noWishlist")}
        body={t("account.wishlistHint")}
        action={
          <Button asChild className="rounded-full">
            <Link href={STORE_PATHS.products}>{t("cart.startShopping")}</Link>
          </Button>
        }
      />
    );
  void cart;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3">
      <AnimatePresence initial={false} mode="popLayout">
      {items.map((w) => (
        <motion.li key={w.productId} layout exit={{ opacity: 0, scale: 0.9 }} className="group relative">
          <Link href={STORE_PATHS.product(w.slug)} className="block">
            <span className="block aspect-[4/5] overflow-hidden rounded-2xl bg-muted">
              <StoreImage src={w.image} alt={w.name} className={cn("transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none", !w.available && "opacity-50 grayscale")} />
            </span>
            <span className="mt-2 line-clamp-2 block text-sm font-medium">{w.name}</span>
            <span className="text-sm font-semibold tabular-nums">{w.available ? money(w.priceMin) : t("account.unavailable")}</span>
          </Link>
          <button
            type="button"
            aria-label={t("product.wishlistRemove")}
            onClick={async () => {
              await call(`/store/me/wishlist/${w.productId}`, { method: "DELETE" }).catch((err) => toast.error(errorMessage(err, t)));
              void qc.invalidateQueries({ queryKey: ["wishlist"] });
            }}
            className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur"
          >
            <HeartIcon className="size-4 fill-primary text-primary" />
          </button>
        </motion.li>
      ))}
      </AnimatePresence>
    </ul>
  );
}

function Profile({ me }: { me: Me }) {
  const { t } = useStore();
  const qc = useQueryClient();
  const [name, setName] = React.useState(me.customer.name ?? "");
  const [email, setEmail] = React.useState(me.customer.email ?? "");
  const [optIn, setOptIn] = React.useState(me.customer.marketingOptIn);
  const save = useMutation({
    mutationFn: () => call("/store/me", { method: "PATCH", body: { name: name.trim(), email: email.trim(), marketingOptIn: optIn } }),
    onSuccess: () => {
      toast.success(t("account.saved"));
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });
  return (
    <form
      className="grid max-w-lg gap-4 rounded-3xl border bg-card p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid content-start gap-1.5">
        <label htmlFor="pf-name" className="text-sm font-medium">
          {t("account.name")}
        </label>
        <input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-[3px] focus:ring-ring/30" />
      </div>
      <div className="grid content-start gap-1.5">
        <label htmlFor="pf-phone" className="text-sm font-medium">
          {t("account.phone")}
        </label>
        <input id="pf-phone" value={prettyPhone(me.customer.phone)} readOnly className="h-11 rounded-xl border border-input bg-muted/50 px-3 text-sm text-muted-foreground" />
      </div>
      <div className="grid content-start gap-1.5">
        <label htmlFor="pf-email" className="text-sm font-medium">
          {t("account.email")}
        </label>
        <input id="pf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-[3px] focus:ring-ring/30" />
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        {t("account.marketing")}
      </label>
      <Button type="submit" className="justify-self-start rounded-full px-6" disabled={save.isPending}>
        {save.isPending && <Loader2Icon className="animate-spin" />}
        {t("account.save")}
      </Button>
    </form>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="sf-shimmer h-20 rounded-2xl" />
      ))}
    </div>
  );
}
