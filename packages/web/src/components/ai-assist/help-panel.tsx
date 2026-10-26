"use client";

import * as React from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRightIcon, CircleHelpIcon, LifeBuoyIcon, Loader2Icon, SendIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Textarea } from "@srirealtime/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { useAiAssistAllowed } from "./use-assist";
import { openSupport } from "../platform/support";

interface HelpResponse {
  answered: boolean;
  answer: string;
  language: "en" | "ta";
  sources: { id: string; guide: string; title: string; chapter: string }[];
  screens: { key: string; label: string; labelTa: string }[];
  credits: number;
}

/** Minimal, safe rendering of the model's answer: paragraphs and numbered/bulleted lines, **bold**. No HTML is ever injected. */
export function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>));
  return (
    <div className="grid gap-2 text-sm leading-relaxed">
      {blocks.map((b, i) => (
        <div key={i} className="grid gap-1">
          {b.split("\n").map((line, j) => (
            <p key={j} className={/^\s*(\d+[.)]|[-*•])\s/.test(line) ? "pl-1" : undefined}>
              {inline(line)}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * "Help" in the top bar: a question box answered in Tamil or English from the RBMS guides (never from the shop's data).
 * `resolveScreen` turns a screen key the guide names ("items", "settings/import") into this app's link, or null.
 * Hidden for people without `ai.use` and for read-only demo sessions.
 */
export function AiHelpButton({ resolveScreen }: { resolveScreen: (key: string) => string | null }) {
  const { t, locale } = useI18n();
  const allowed = useAiAssistAllowed();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState<HelpResponse | null>(null);
  const [asked, setAsked] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  if (!allowed) return null;

  const ask = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setRes(null);
    setAsked(question);
    try {
      setRes(await api.post<HelpResponse>("/ai/assist/help", { question }));
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" className="gap-1.5 px-2" aria-label={t("web.aiAssist.help.button")} onClick={() => setOpen(true)}>
        <CircleHelpIcon />
        <span className="hidden text-xs font-semibold sm:inline">{t("web.aiAssist.help.button")}</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("web.aiAssist.help.title")}</SheetTitle>
            <SheetDescription>{t("web.aiAssist.help.intro")}</SheetDescription>
          </SheetHeader>
          <form onSubmit={ask} className="grid gap-2 px-4">
            <Textarea
              rows={3}
              maxLength={400}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("web.aiAssist.help.placeholder")}
              aria-label={t("web.aiAssist.help.title")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) void ask(e as unknown as React.FormEvent);
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-meta text-muted-foreground">{t("web.aiAssist.help.credits")}</p>
              <Button type="submit" size="sm" disabled={busy || q.trim().length < 3}>
                {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {busy ? t("web.aiAssist.help.asking") : t("web.aiAssist.help.ask")}
              </Button>
            </div>
          </form>
          <div className="grid gap-3 px-4 pb-4" aria-live="polite">
            {!res && !busy && !error && <p className="text-sm text-muted-foreground">{t("web.aiAssist.help.examples")}</p>}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {res && (
              <div className="grid gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-border ring-inset" lang={res.language}>
                <p className="text-xs font-medium text-muted-foreground">{asked}</p>
                {res.answered ? <Answer text={res.answer} /> : <p className="text-sm">{res.answer || t("web.aiAssist.help.unknown")}</p>}
                {!res.answered && (
                  <div className="grid gap-1.5">
                    <p className="text-meta text-muted-foreground">{t("web.platform.support.contactHint")}</p>
                    <Button
                      size="sm"
                      className="justify-self-start"
                      onClick={() => {
                        setOpen(false);
                        openSupport({ question: asked, screen: pathname });
                      }}
                    >
                      <LifeBuoyIcon /> {t("web.platform.support.contact")}
                    </Button>
                  </div>
                )}
                {res.answered && res.screens.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {res.screens
                      .map((s) => ({ s, href: resolveScreen(s.key) }))
                      .filter((x): x is { s: HelpResponse["screens"][number]; href: string } => !!x.href)
                      .map(({ s, href }) => (
                        <Button key={s.key} asChild size="sm" variant="outline" onClick={() => setOpen(false)}>
                          <NextLink href={href}>
                            {t("web.aiAssist.help.open", { screen: locale === "ta" ? s.labelTa : s.label })} <ArrowRightIcon />
                          </NextLink>
                        </Button>
                      ))}
                  </div>
                )}
                {res.answered && res.sources.length > 0 && (
                  <p className="text-meta text-muted-foreground">
                    {t("web.aiAssist.help.sources")}: {res.sources.map((x) => x.title).join(" · ")}
                  </p>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
