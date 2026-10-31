"use client";

import * as React from "react";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, StatusPill, toast } from "@rbms/ui";
import { describeError, useFeature, useI18n } from "@rbms/web";
import { money } from "../../lib/format";
import { useExplain2b } from "../../lib/ai-money";

/** GSTR-2B tab: "Explain mismatches". Written from the comparison the GST module already did; reasons to check, never a verdict. */
export function Explain2bCard({ month, openCount }: { month: string; openCount: number }) {
  const { t, locale } = useI18n();
  const lang = locale === "ta" ? "ta" : "en";
  const aiOn = useFeature("ai");
  const ex = useExplain2b(month);
  // The explanation belongs to one month and one language.
  const [shown, setShown] = React.useState<string>("");
  React.useEffect(() => {
    ex.reset();
    setShown("");
  }, [month, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!aiOn) return null;
  const run = () =>
    ex.mutate(lang, {
      onSuccess: () => setShown(month),
      onError: (e) => toast.error(describeError(e, t)),
    });
  const data = shown === month ? ex.data : undefined;
  return (
    <Card data-testid="explain-2b">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("billing.gst2bx.title")}</CardTitle>
          <p className="text-meta text-muted-foreground">{t("billing.gst2bx.hint")}</p>
        </div>
        <Button type="button" variant="outline" className="h-11 shrink-0 sm:h-9" disabled={ex.isPending || openCount === 0} onClick={run}>
          {ex.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {data ? t("billing.gst2bx.again") : t("billing.gst2bx.button")}
        </Button>
      </CardHeader>
      {openCount === 0 && <CardContent className="text-sm text-muted-foreground">{t("billing.gst2bx.nothing")}</CardContent>}
      {data && (
        <CardContent className="grid gap-3">
          {data.groups.map((g) => (
            <div key={g.group} className="rounded-xl border p-3 text-sm" data-testid={`explain-2b-${g.group}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{g.title[lang]}</p>
                <StatusPill tone={g.group === "missing_in_2b" || g.group === "missing_in_books" ? "danger" : "warning"}>
                  {t("billing.gst2bx.count", { count: g.count, tax: money(g.tax) })}
                </StatusPill>
              </div>
              <p className="mt-1.5 leading-relaxed">{g.text}</p>
              {g.examples.length > 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {g.examples.map((e) => `${e.supplier} ${e.number} (${money(e.tax)})`).join(" · ")}
                </p>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{data.credits > 0 ? t("billing.gst2bx.aiNote", { credits: data.credits }) : t("billing.gst2bx.standard")}</p>
        </CardContent>
      )}
    </Card>
  );
}
