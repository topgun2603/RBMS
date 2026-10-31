"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  CircleHelpIcon,
  KeyRoundIcon,
  LockIcon,
  LogOutIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  UsersRoundIcon,
  MapPinIcon,
  MoreVerticalIcon,
  PauseIcon,
  Undo2Icon,
  UserRoundIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rbms/ui";
import { LocaleSwitcher, ThemeToggle, useI18n, useModuleNavigate } from "@rbms/web";
import { timeShort, todayIST } from "../lib/format";
import type { DayRecord } from "../lib/storage";
import { NoSaleButton, NoSaleMenuItem } from "./drawer-button";
import { MyPinDialog } from "./my-pin-dialog";
import { usePos } from "./pos-context";

export interface TopBarProps {
  /** The open till session of this register (as a day). */
  day: Pick<DayRecord, "date" | "openedAt" | "closedAt"> | null;
  holds: number;
  onHolds: () => void;
  onReturns: () => void;
  onDay: () => void;
  /** The customer display dialog. */
  onDisplay: () => void;
  onHelp: () => void;
  onExit: () => void;
}

/** Compact counter bar: shop · branch, cashier, online, day status, holds/returns/day/help, exit. */
export function TopBar(p: TopBarProps) {
  const { t } = useI18n();
  const { shopName, branch, branches, setBranch, cashier, online, terminal, has } = usePos();
  const qc = useQueryClient();
  const navigate = useModuleNavigate();
  const [myPin, setMyPin] = React.useState(false);
  const lockLabel = terminal ? t("pos.terminal.lock") : t("pos.top.exit");
  const ExitIcon = terminal ? LockIcon : LogOutIcon;
  const today = todayIST();
  const day = p.day && p.day.date === today ? p.day : null;
  const dayState = !day ? "none" : day.closedAt ? "closed" : "open";

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-semibold sm:text-base">{shopName}</span>
        {terminal && (
          <Badge variant="outline" className="gap-1" data-terminal-name="">
            <MonitorSmartphoneIcon /> {terminal.device.terminal.name}
          </Badge>
        )}
        {branches.length > 1 && branch ? (
          <Select
            value={branch.code}
            onValueChange={(code) => {
              setBranch(code);
              void qc.invalidateQueries({ queryKey: ["pos"] });
            }}
          >
            <SelectTrigger className="h-9 w-auto max-w-44 gap-1 text-xs" aria-label={t("pos.top.branch")}>
              <MapPinIcon className="size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.code}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : branch ? (
          <Badge variant="muted" className="hidden gap-1 sm:inline-flex">
            <MapPinIcon /> {branch.name}
          </Badge>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <span
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
            online.online ? "bg-success/15 text-success-ink" : "bg-destructive/15 text-destructive",
          )}
          role="status"
          aria-live="polite"
        >
          {online.online ? <WifiIcon className="size-3.5" /> : <WifiOffIcon className="size-3.5" />}
          <span className="hidden sm:inline">{online.online ? t("pos.top.online") : t("pos.top.offline")}</span>
        </span>

        <button
          type="button"
          onClick={p.onDay}
          className={cn(
            "hidden h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 md:inline-flex",
            dayState === "open" ? "border-success/40" : "border-warning/60 bg-warning/10",
          )}
        >
          <CalendarClockIcon className="size-3.5" />
          {dayState === "open" ? t("pos.top.dayOpen", { time: timeShort(day!.openedAt) }) : dayState === "closed" ? t("pos.top.dayClosed") : t("pos.top.dayNotOpen")}
        </button>

        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:inline-flex">
          <UserRoundIcon className="size-3.5" /> {cashier}
        </span>

        <Button type="button" variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={p.onHolds}>
          <PauseIcon /> {t("pos.top.holds")}
          {p.holds > 0 && <Badge className="tabular-nums">{p.holds}</Badge>}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={p.onReturns}>
          <Undo2Icon /> {t("pos.top.returns")}
        </Button>
        <NoSaleButton />
        <div className="hidden lg:flex">
          <ThemeToggle />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={t("pos.top.menu")} className="relative">
              <MoreVerticalIcon />
              {p.holds > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary lg:hidden" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
              <UserRoundIcon className="size-4" /> {cashier}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={p.onHolds}>
              <PauseIcon /> {t("pos.top.holds")} {p.holds > 0 && `(${p.holds})`}
              <DropdownMenuShortcut>F7</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onReturns}>
              <Undo2Icon /> {t("pos.top.returns")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onDay}>
              <CalendarClockIcon /> {t("pos.top.day")}
            </DropdownMenuItem>
            <NoSaleMenuItem />
            <DropdownMenuItem onSelect={p.onDisplay}>
              <MonitorIcon /> {t("pos.display.menu")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onHelp}>
              <CircleHelpIcon /> {t("pos.top.help")}
              <DropdownMenuShortcut>?</DropdownMenuShortcut>
            </DropdownMenuItem>
            {terminal ? (
              <DropdownMenuItem onSelect={() => terminal.lock("locked")}>
                <UsersRoundIcon /> {t("pos.terminal.switch")}
              </DropdownMenuItem>
            ) : has.terminals ? (
              <>
                <DropdownMenuItem onSelect={() => setMyPin(true)}>
                  <KeyRoundIcon /> {t("pos.pin.myTitle")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("terminal")}>
                  <MonitorSmartphoneIcon /> {t("pos.terminal.useDevice")}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={p.onExit} variant={terminal ? "default" : "destructive"}>
              <ExitIcon /> {lockLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="outline" size="sm" className="hidden sm:inline-flex" onClick={p.onExit}>
          <ExitIcon /> {lockLabel}
        </Button>
        {!terminal && has.terminals && <MyPinDialog open={myPin} onClose={() => setMyPin(false)} />}
      </div>
    </header>
  );
}
