"use client";

import * as React from "react";
import { MonitorSmartphoneIcon, ReceiptIndianRupeeIcon } from "lucide-react";
import { useReducedMotionSafe } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";
import { useSite } from "../site-context";
import { SaleCounter } from "./counter";
import { useSale } from "./sale";
import { StoreDemo } from "./store-demo";

type Tab = "counter" | "store";

/** The two products side by side in one place: bill at the counter, or be the shopper on the store. Both work. */
export function HeroDemo() {
  const { t } = useSite();
  const sale = useSale();
  const reduced = useReducedMotionSafe();
  const [tab, setTab] = React.useState<Tab>("counter");
  const [storeTouched, setStoreTouched] = React.useState(false);
  const [picked, setPicked] = React.useState(false);

  // Left alone, the page shows both: once the counter's demo bill is paid, it turns to the store.
  const stopped = sale.touched || storeTouched || picked;
  React.useEffect(() => {
    if (reduced || stopped || !sale.paid || tab !== "counter") return;
    const id = window.setTimeout(() => setTab("store"), 3800);
    return () => window.clearTimeout(id);
  }, [reduced, stopped, sale.paid, tab]);

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "counter", label: t("home.tab.counter"), icon: <ReceiptIndianRupeeIcon /> },
    { id: "store", label: t("home.tab.store"), icon: <MonitorSmartphoneIcon /> },
  ];

  return (
    <div>
      <div className="mx-auto mb-4 grid w-full max-w-[30rem] grid-cols-2 gap-1 rounded-2xl bg-ink p-1" role="tablist" aria-label={t("home.tab.label")}>
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls={`panel-${x.id}`}
            onClick={() => {
              setPicked(true);
              setTab(x.id);
            }}
            className={cn("flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-bold transition-colors focus-ring [&_svg]:size-4", tab === x.id ? "bg-paper text-ink" : "text-paper/80 hover:text-paper")}
            data-testid={`tab-${x.id}`}
          >
            {x.icon}
            {x.label}
          </button>
        ))}
      </div>
      <div id="panel-counter" role="tabpanel" aria-labelledby="tab-counter" hidden={tab !== "counter"}>
        <SaleCounter />
      </div>
      <div id="panel-store" role="tabpanel" aria-labelledby="tab-store" hidden={tab !== "store"}>
        <StoreDemo active={tab === "store"} stopped={sale.touched || storeTouched} onTouch={() => setStoreTouched(true)} />
      </div>
    </div>
  );
}
