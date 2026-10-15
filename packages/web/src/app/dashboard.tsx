"use client";

import * as React from "react";
import { LayoutDashboardIcon } from "lucide-react";
import { cn, EmptyState, Skeleton, Stagger, StaggerItem } from "@srirealtime/ui";
import { Page } from "../components/page";
import { useI18n } from "../lib/i18n";
import { ModuleScope, useModule, useWebApp } from "./navigation";
import { useVisible } from "./session";
import type { MountedModule, WidgetDef } from "./types";

const SIZE: Record<WidgetDef["size"], string> = { sm: "", md: "lg:col-span-2", lg: "lg:col-span-3" };

/** Dashboard cards of the given modules (default: every mounted module), each with its features and roles applied. */
export function WidgetGrid({ modules: only, className }: { modules?: string[]; className?: string }) {
  const app = useWebApp();
  const { t } = useI18n();
  const visible = useVisible();
  const widgets = React.useMemo(
    () =>
      app.modules
        .filter((m) => !only || only.includes(m.id))
        .flatMap((m) => (m.widgets ?? []).filter((w) => visible(w, m)).map((w) => ({ w, m }))),
    [app, only, visible],
  );
  if (widgets.length === 0) return <EmptyState icon={LayoutDashboardIcon} title={t("web.dashboard.empty")} />;
  return (
    <Stagger className={cn("grid gap-4 lg:grid-cols-3", className)} stagger={0.06} delay={0.05}>
      {widgets.map(({ w, m }) => (
        <StaggerItem key={`${m.id}:${w.id}`} className={cn("min-w-0", SIZE[w.size], w.rowSpan === 2 && "lg:row-span-2")}>
          <Widget module={m} widget={w} />
        </StaggerItem>
      ))}
    </Stagger>
  );
}

function Widget({ module, widget }: { module: MountedModule; widget: WidgetDef }) {
  const C = widget.component;
  return (
    <ModuleScope module={module}>
      <React.Suspense fallback={<Skeleton className={cn("h-full min-h-48 w-full rounded-2xl", widget.size === "lg" && "min-h-64")} />}>
        <C />
      </React.Suspense>
    </ModuleScope>
  );
}

/** The app home ("/"): widgets from every mounted module. */
export function Dashboard() {
  return (
    <Page className="max-w-6xl">
      <WidgetGrid />
    </Page>
  );
}

/** A module's own overview (its widgets only), for a module mounted below "/": billingModule at /billing → /billing. */
export function ModuleDashboard() {
  const { id } = useModule();
  const only = React.useMemo(() => [id], [id]);
  return (
    <Page className="max-w-6xl">
      <WidgetGrid modules={only} />
    </Page>
  );
}
