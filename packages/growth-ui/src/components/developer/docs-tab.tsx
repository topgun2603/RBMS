"use client";

import * as React from "react";
import { BookOpenIcon, ExternalLinkIcon, RepeatIcon, ShieldCheckIcon, TerminalIcon } from "lucide-react";
import { Button, Stagger, StaggerItem } from "@srirealtime/ui";
import { apiUrl, useI18n, useOptionalShop } from "@srirealtime/web";
import { AUTO_DISABLE_AFTER, curlSample, NODE_VERIFY_SAMPLE, RETRY_SCHEDULE, SIGNATURE_EXAMPLE, SIGNATURE_TOLERANCE_SEC } from "../../lib/developer";
import { SectionCard } from "../bits";
import { CodeBlock } from "./json-view";

const Mono = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-all">{children}</code>;

/** How to verify webhooks and call the API with a key. */
export function DocsTab() {
  const { t } = useI18n();
  const shop = useOptionalShop();
  const slug = shop?.tenant.slug ?? "";
  const apiBase = apiUrl("");
  const openApi = apiUrl("/developer/openapi.json");

  const headers: [string, string][] = [
    ["x-srikit-signature", t("growth.developer.docs.headerSignature")],
    ["x-srikit-event", t("growth.developer.docs.headerEvent")],
    ["x-srikit-delivery", t("growth.developer.docs.headerDelivery")],
  ];

  return (
    <Stagger className="grid gap-4">
      <StaggerItem>
        <SectionCard icon={ShieldCheckIcon} title={t("growth.developer.docs.verifyTitle")} description={t("growth.developer.docs.verifyBody")} contentClassName="grid gap-4">
          <div className="grid gap-1.5">
            <p className="text-sm">{t("growth.developer.docs.formatIntro")}</p>
            <CodeBlock code={`x-srikit-signature: ${SIGNATURE_EXAMPLE}`} label={t("growth.developer.docs.headerLabel")} wrap />
          </div>
          <ol className="grid list-decimal gap-2 pl-5 text-sm marker:text-muted-foreground">
            <li>
              {t("growth.developer.docs.step1")} <Mono>t</Mono>, <Mono>v1</Mono>. <span className="text-muted-foreground">{t("growth.developer.docs.step1Rotation")}</span>
            </li>
            <li>{t("growth.developer.docs.step2", { seconds: SIGNATURE_TOLERANCE_SEC })}</li>
            <li>
              {t("growth.developer.docs.step3")} <Mono>{'HMAC-SHA256(secret, "<t>.<raw body>")'}</Mono>
            </li>
            <li>{t("growth.developer.docs.step4")}</li>
            <li className="font-medium">{t("growth.developer.docs.step5")}</li>
          </ol>
          <CodeBlock code={NODE_VERIFY_SAMPLE} label="Node.js · Express" maxHeight="max-h-[28rem]" />
        </SectionCard>
      </StaggerItem>

      <StaggerItem>
        <SectionCard icon={RepeatIcon} title={t("growth.developer.docs.deliveryTitle")} description={t("growth.developer.docs.deliveryBody")} contentClassName="grid gap-4">
          <dl className="divide-y rounded-xl border">
            {headers.map(([h, d]) => (
              <div key={h} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt>
                  <Mono>{h}</Mono>
                </dt>
                <dd className="text-sm text-muted-foreground">{d}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-2 text-sm">
            <p>{t("growth.developer.docs.success")}</p>
            <p>
              {t("growth.developer.docs.retries")}{" "}
              <span className="inline-flex flex-wrap gap-1 align-middle">
                {RETRY_SCHEDULE.map((r) => (
                  <span key={r} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {r}
                  </span>
                ))}
              </span>
            </p>
            <p className="text-muted-foreground">{t("growth.developer.docs.autoOff", { count: AUTO_DISABLE_AFTER })}</p>
            <p className="text-muted-foreground">{t("growth.developer.docs.dedupe")}</p>
          </div>
        </SectionCard>
      </StaggerItem>

      <StaggerItem>
        <SectionCard
          icon={TerminalIcon}
          title={t("growth.developer.docs.apiTitle")}
          description={t("growth.developer.docs.apiBody")}
          contentClassName="grid gap-4"
          action={
            <Button asChild variant="outline" size="sm">
              <a href={openApi} target="_blank" rel="noopener noreferrer">
                <BookOpenIcon /> <span className="hidden sm:inline">{t("growth.developer.docs.openApi")}</span>
                <span className="sm:hidden">OpenAPI</span>
                <ExternalLinkIcon className="size-3.5" />
              </a>
            </Button>
          }
        >
          <ul className="grid gap-2 text-sm">
            <li>
              {t("growth.developer.docs.authHeader")} <Mono>Authorization: Bearer sk_live_…</Mono>
            </li>
            <li>
              {t("growth.developer.docs.tenantHeader")} <Mono>x-tenant: {slug || "<shop slug>"}</Mono>
            </li>
            <li className="text-muted-foreground">{t("growth.developer.docs.scopesNote")}</li>
          </ul>
          <CodeBlock code={curlSample(apiBase, slug)} label="curl" wrap />
        </SectionCard>
      </StaggerItem>
    </Stagger>
  );
}
