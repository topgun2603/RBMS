"use client";

import * as React from "react";
import { CheckCircle2Icon, ChevronDownIcon, LayoutDashboardIcon, Loader2Icon, MoreHorizontalIcon, ArrowRightIcon, BellRingIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  motion,
  AnimatePresence,
  Skeleton,
  Stagger,
  StaggerItem,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { Page } from "../components/page";
import { useMe } from "../lib/auth";
import { useOptionalShop } from "../lib/branding";
import { useI18n } from "../lib/i18n";
import { readStored, writeStored } from "../lib/session";
import { AttentionContext, AttentionPending, AttentionStore, KpiSlotContext, KpiTileSkeleton } from "./dashboard-parts";
import { layoutWidgets, mergeQuickActions, type MergedAction, type PlacedWidget } from "./model";
import { AppLink, ModuleScope, useModule, useWebApp } from "./navigation";
import { useVisible } from "./session";
import type { WidgetDef, WidgetZone } from "./types";

/*
 * The structured dashboard (docs/web-modules.md → Dashboard). Every mounted module contributes widgets to zones; the
 * page is always the same shape:
 *
 *   header (greeting, date, one merged quick-actions bar)
 *   setup strip (onboarding, while incomplete)
 *   KPI strip (3–5 headline tiles, the first one is the accent)
 *   ┌ main (wide): charts, recent activity ┐┌ needs attention (one card of rows) ┐
 *   │                                       ││ side: short lists                  │
 *   more insights (compact even grid, collapsible)
 *
 * On phones the order is header → setup → KPIs → needs attention → main → side → more insights.
 * Each widget loads on its own (Suspense + error boundary): a failing one never takes the page down.
 */

const SECONDARY_SPAN: Record<NonNullable<WidgetDef["size"]>, string> = { sm: "", md: "sm:col-span-2", lg: "sm:col-span-2 lg:col-span-3" };
const KPI_COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" };
// Even rows: 2 cards → two columns, 4 → four, otherwise three.
const INSIGHT_COLS: Record<number, string> = { 1: "lg:grid-cols-2", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-2 xl:grid-cols-4", 5: "lg:grid-cols-3" };
const INSIGHTS_KEY = "sr_dash_insights";

/** The app home ("/"): every mounted module's widgets, laid out by zone. */
export function Dashboard() {
  return <StructuredDashboard />;
}

/** A module's own overview (its widgets only), for a module mounted below "/": billingModule at /billing → /billing. */
export function ModuleDashboard() {
  const { id } = useModule();
  const only = React.useMemo(() => [id], [id]);
  return <StructuredDashboard modules={only} />;
}

function StructuredDashboard({ modules }: { modules?: readonly string[] }) {
  const app = useWebApp();
  const visible = useVisible();
  const { t } = useI18n();
  const zones = React.useMemo(() => layoutWidgets(app, visible, { modules }), [app, visible, modules]);
  const actions = React.useMemo(() => mergeQuickActions(app, visible, modules), [app, visible, modules]);
  const attention = React.useMemo(() => new AttentionStore(), []);
  const total = Object.values(zones).reduce((n, z) => n + z.length, 0);

  return (
    <Page className="grid grid-cols-1 gap-5 sm:gap-6">
      <DashboardHeader actions={actions} />
      {total === 0 ? (
        <EmptyState icon={LayoutDashboardIcon} title={t("web.dashboard.empty")} />
      ) : (
        <>
          {zones.setup.length > 0 && (
            <div className="grid grid-cols-1 gap-3 empty:hidden">
              {zones.setup.map((p) => (
                <ZoneWidget key={key(p)} placed={p} zone="setup" />
              ))}
            </div>
          )}
          {zones.kpi.length > 0 && <KpiStrip items={zones.kpi} />}
          <AttentionContext.Provider value={attention}>
            <Body zones={zones} />
          </AttentionContext.Provider>
          {zones.secondary.length > 0 && <Insights items={zones.secondary} />}
        </>
      )}
    </Page>
  );
}

const key = (p: PlacedWidget) => `${p.module.id}:${p.widget.id}`;

// ---------------------------------------------------------------- header

function DashboardHeader({ actions }: { actions: MergedAction[] }) {
  const { t, formatDate } = useI18n();
  const shop = useOptionalShop();
  const me = useMe();
  const first = me.data?.user.name?.trim().split(/\s+/)[0];
  const today = formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" });
  // Phones: two buttons + More; from sm up: four + More.
  const phoneMore = actions.slice(2);
  const wideMore = actions.slice(4);

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="min-w-0 space-y-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <time dateTime={new Date().toISOString().slice(0, 10)}>{today}</time>
        </p>
        <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
          {first ? t("web.dashboard.greetingName", { name: first }) : t("web.dashboard.greeting")}
        </h1>
        {shop?.shopName && <p className="truncate text-sm text-muted-foreground">{t("web.dashboard.subtitle", { shop: shop.shopName })}</p>}
      </motion.div>
      {actions.length > 0 && (
        <nav aria-label={t("web.dashboard.quickActions")} className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          {actions.slice(0, 4).map((a, i) => (
            <ActionButton key={`${a.module.id}:${a.id}`} action={a} main={i === 0} className={i >= 2 ? "hidden sm:inline-flex" : undefined} />
          ))}
          {phoneMore.length > 0 && <MoreActions actions={phoneMore} className="sm:hidden" />}
          {wideMore.length > 0 && <MoreActions actions={wideMore} className="hidden sm:inline-flex" />}
        </nav>
      )}
    </header>
  );
}

function ActionButton({ action: a, main, className }: { action: MergedAction; main: boolean; className?: string }) {
  const { t } = useI18n();
  const Icon = a.icon ?? ArrowRightIcon;
  return (
    <Button asChild variant={main ? "default" : "outline"} className={cn("h-10 rounded-full px-4", !main && "bg-card", className)}>
      <AppLink href={a.absHref}>
        <Icon /> {t(a.label)}
      </AppLink>
    </Button>
  );
}

function MoreActions({ actions, className }: { actions: MergedAction[]; className?: string }) {
  const { t } = useI18n();
  // Rendered twice (phone set / wide set); only one is visible, so `display` must stay with the class.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn("h-10 rounded-full bg-card px-3.5", className)}>
          <MoreHorizontalIcon /> {t("web.dashboard.moreActions")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {actions.map((a) => {
          const Icon = a.icon ?? ArrowRightIcon;
          return (
            <DropdownMenuItem key={`${a.module.id}:${a.id}`} asChild>
              <AppLink href={a.absHref}>
                <Icon /> {t(a.label)}
              </AppLink>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------- KPI strip

function KpiStrip({ items }: { items: PlacedWidget[] }) {
  const { t } = useI18n();
  const odd = items.length % 2 === 1;
  return (
    <section aria-label={t("web.dashboard.kpis")}>
      <Stagger className={cn("grid grid-cols-2 gap-3 sm:gap-4", KPI_COLS[items.length])} stagger={0.06}>
        {items.map((p, i) => (
          <StaggerItem key={key(p)} className={cn("min-w-0", odd && i === 0 && "col-span-2 lg:col-span-1")}>
            <KpiSlotContext.Provider value={i === 0 ? ACCENT : PLAIN}>
              <ZoneWidget placed={p} zone="kpi" />
            </KpiSlotContext.Provider>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
const ACCENT = { accent: true };
const PLAIN = { accent: false };

// ---------------------------------------------------------------- main / side / attention

function Body({ zones }: { zones: Record<WidgetZone, PlacedWidget[]> }) {
  const { main, side, attention } = zones;
  if (!main.length && !side.length && !attention.length) return null;
  const attentionCard = attention.length > 0 && <AttentionCard items={attention} />;
  const stack = (items: PlacedWidget[], zone: WidgetZone) =>
    items.map((p) => (
      <StaggerItem key={key(p)} className="min-w-0 empty:hidden">
        <ZoneWidget placed={p} zone={zone} />
      </StaggerItem>
    ));

  if (!main.length) {
    // Nothing wide: the attention card and the side lists share one even grid.
    return (
      <Stagger className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3" stagger={0.06} delay={0.05}>
        {attentionCard && <StaggerItem className="min-w-0">{attentionCard}</StaggerItem>}
        {stack(side, "side")}
      </Stagger>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-5">
      {attentionCard && <div className="min-w-0 lg:col-start-2 lg:row-start-1">{attentionCard}</div>}
      <Stagger className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:gap-5" stagger={0.06} delay={0.05}>
        {stack(main, "main")}
      </Stagger>
      {side.length > 0 && (
        <Stagger
          className={cn("grid min-w-0 grid-cols-1 content-start gap-4 lg:col-start-2 lg:gap-5", attentionCard ? "lg:row-start-2" : "lg:row-span-2 lg:row-start-1")}
          stagger={0.06}
          delay={0.1}
        >
          {stack(side, "side")}
        </Stagger>
      )}
    </div>
  );
}

function AttentionCard({ items }: { items: PlacedWidget[] }) {
  const { t } = useI18n();
  const store = React.useContext(AttentionContext)!;
  React.useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const { pending, shown } = store.summary();
  const clear = pending === 0 && shown === 0;

  return (
    <Card aria-busy={pending > 0 || undefined}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className={cn("icon-chip size-8", shown > 0 ? "text-warning-ink" : "text-success-ink")}>
            <BellRingIcon className="size-4" />
          </span>
          {t("web.dashboard.attention")}
        </CardTitle>
        {pending > 0 && shown > 0 && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label={t("web.common.loading")} />}
      </CardHeader>
      <CardContent>
        <ul className="-mx-2.5 flex flex-col gap-0.5">
          {items.map((p) => (
            <ZoneWidget key={key(p)} placed={p} zone="attention" />
          ))}
        </ul>
        {pending > 0 && shown === 0 && (
          <div className="grid gap-2 px-2.5 py-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-xl" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-8" />
              </div>
            ))}
          </div>
        )}
        <AnimatePresence initial={false}>
          {clear && (
            <motion.div
              key="clear"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mx-2 flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 px-3 py-3"
            >
              <CheckCircle2Icon className="size-5 shrink-0 text-success-ink" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-success-ink">{t("web.dashboard.allClear")}</p>
                <p className="text-xs text-muted-foreground">{t("web.dashboard.allClearBody")}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- more insights

function Insights({ items }: { items: PlacedWidget[] }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => setOpen(readStored(INSIGHTS_KEY) !== "0"), []);
  const toggle = () =>
    setOpen((o) => {
      writeStored(INSIGHTS_KEY, o ? "0" : "1");
      return !o;
    });
  const id = React.useId();

  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-3">
      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <h2 id={`${id}-h`} className="font-heading text-base font-semibold">
          {t("web.dashboard.insights")}
        </h2>
        <Button variant="ghost" size="sm" className="text-muted-foreground" aria-expanded={open} aria-controls={`${id}-g`} onClick={toggle}>
          {open ? t("web.dashboard.hide") : t("web.dashboard.show")}
          <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-g`}
            key="grid"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="-m-1 overflow-hidden p-1"
          >
            <Stagger className={cn("grid grid-cols-1 auto-rows-fr gap-4 sm:grid-cols-2", INSIGHT_COLS[Math.min(items.length, 5)])} stagger={0.05}>
              {items.map((p) => (
                <StaggerItem key={key(p)} className={cn("min-w-0 empty:hidden", SECONDARY_SPAN[p.widget.size ?? "sm"])}>
                  <ZoneWidget placed={p} zone="secondary" />
                </StaggerItem>
              ))}
            </Stagger>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ---------------------------------------------------------------- one widget

function ZoneWidget({ placed, zone }: { placed: PlacedWidget; zone: WidgetZone }) {
  const C = placed.widget.component;
  return (
    <ModuleScope module={placed.module}>
      <WidgetBoundary zone={zone}>
        <React.Suspense fallback={<ZoneSkeleton zone={zone} />}>
          <C />
        </React.Suspense>
      </WidgetBoundary>
    </ModuleScope>
  );
}

function ZoneSkeleton({ zone }: { zone: WidgetZone }) {
  switch (zone) {
    case "kpi":
      return <KpiTileSkeleton />;
    case "attention":
      return <AttentionPending />;
    case "setup":
      return <Skeleton className="h-20 w-full rounded-2xl" />;
    case "secondary":
      return <Skeleton className="h-full min-h-36 w-full rounded-2xl" />;
    case "main":
      return <Skeleton className="h-72 w-full rounded-2xl" />;
    default:
      return <Skeleton className="h-56 w-full rounded-2xl" />;
  }
}

class WidgetBoundary extends React.Component<{ zone: WidgetZone; children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("[dashboard] widget failed", error);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    // A broken to-do row just disappears; anything else keeps its place with a retry.
    if (this.props.zone === "attention" || this.props.zone === "setup") return null;
    return <WidgetFailed zone={this.props.zone} onRetry={() => this.setState({ failed: false })} />;
  }
}

function WidgetFailed({ zone, onRetry }: { zone: WidgetZone; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        "flex h-full flex-col items-start justify-center gap-2 rounded-2xl border border-dashed bg-card/60 p-4 text-sm text-muted-foreground",
        zone === "kpi" ? "min-h-32 sm:min-h-36" : "min-h-36",
      )}
    >
      <p>{t("web.dashboard.widgetError")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("web.common.retry")}
      </Button>
    </div>
  );
}

/**
 * @deprecated The flat card grid of the first dashboard. Kept for hosts that rendered it directly; it now renders the
 * structured layout of the given modules (without the header).
 */
export function WidgetGrid({ modules: only, className }: { modules?: string[]; className?: string }) {
  const app = useWebApp();
  const visible = useVisible();
  const zones = React.useMemo(() => layoutWidgets(app, visible, { modules: only }), [app, visible, only]);
  const attention = React.useMemo(() => new AttentionStore(), []);
  return (
    <div className={cn("grid grid-cols-1 gap-5", className)}>
      {zones.kpi.length > 0 && <KpiStrip items={zones.kpi} />}
      <AttentionContext.Provider value={attention}>
        <Body zones={zones} />
      </AttentionContext.Provider>
      {zones.secondary.length > 0 && <Insights items={zones.secondary} />}
    </div>
  );
}
