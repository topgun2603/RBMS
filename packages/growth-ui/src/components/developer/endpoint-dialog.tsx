"use client";

import * as React from "react";
import { Loader2Icon, WebhookIcon } from "lucide-react";
import {
  Button,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
  toast,
} from "@rbms/ui";
import { ApiError, describeError, useI18n } from "@rbms/web";
import { eventsForApi, isAllEvents, urlProblem } from "../../lib/developer";
import { useCreateEndpoint, useEvents, useUpdateEndpoint } from "../../lib/queries/developer";
import type { WebhookEndpoint } from "../../lib/types";
import { InlineError } from "../bits";
import { EventPicker } from "./event-picker";

/** Add / edit a webhook endpoint in a side sheet. A new endpoint's signing secret goes to `onCreated` (shown once). */
export function EndpointSheet({
  open,
  endpoint,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  /** null = new endpoint. */
  endpoint: WebhookEndpoint | null;
  onOpenChange: (o: boolean) => void;
  onCreated: (secret: string, endpoint: WebhookEndpoint) => void;
}) {
  const { t } = useI18n();
  const events = useEvents();
  const create = useCreateEndpoint();
  const update = useUpdateEndpoint();
  const busy = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [all, setAll] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [active, setActive] = React.useState(true);
  const [tried, setTried] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setUrl(endpoint?.url ?? "");
    setDescription(endpoint?.description ?? "");
    setAll(endpoint ? isAllEvents(endpoint.events) : true);
    setSelected(new Set(endpoint && !isAllEvents(endpoint.events) ? endpoint.events : []));
    setActive(endpoint?.active ?? true);
    setTried(false);
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpoint?.id]);

  const problem = urlProblem(url);
  const serverUrlError = error instanceof ApiError && (error.details as { field?: string } | undefined)?.field === "url" ? error.message : null;
  const urlError = tried && problem && problem !== "http" ? t(`growth.developer.endpoints.urlErrors.${problem}`) : serverUrlError;
  const eventsError = tried && !all && selected.size === 0 ? t("growth.developer.endpoints.eventsRequired") : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if ((problem && problem !== "http") || (!all && selected.size === 0)) return;
    const body = { url: url.trim(), description: description.trim() || null, events: eventsForApi(selected, all) };
    try {
      if (endpoint) {
        await update.mutateAsync({ id: endpoint.id, ...body });
        toast.success(t("growth.common.saved"));
        onOpenChange(false);
      } else {
        const res = await create.mutateAsync({ ...body, active });
        onOpenChange(false);
        onCreated(res.secret, res.endpoint);
      }
    } catch {
      // inline
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" closeLabel={t("growth.common.close")}>
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <WebhookIcon className="size-4 text-primary" />
            {endpoint ? t("growth.developer.endpoints.editTitle") : t("growth.developer.endpoints.addTitle")}
          </SheetTitle>
          <SheetDescription>{t("growth.developer.endpoints.sheetBody")}</SheetDescription>
        </SheetHeader>
        <form id="endpoint-form" onSubmit={submit} noValidate className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
          <Field invalid={!!urlError}>
            <FieldLabel>{t("growth.developer.endpoints.url")}</FieldLabel>
            <FieldControl>
              <Input
                type="url"
                inputMode="url"
                className="font-mono"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/rbms"
                autoComplete="off"
                autoFocus={!endpoint}
                maxLength={2000}
              />
            </FieldControl>
            <FieldHint>{problem === "http" ? t("growth.developer.endpoints.httpWarning") : t("growth.developer.endpoints.urlHint")}</FieldHint>
            <FieldError>{urlError}</FieldError>
          </Field>
          <Field>
            <FieldLabel optional={t("growth.common.optional")}>{t("growth.developer.endpoints.description")}</FieldLabel>
            <FieldControl>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} placeholder={t("growth.developer.endpoints.descriptionPlaceholder")} />
            </FieldControl>
          </Field>
          <Field invalid={!!eventsError}>
            <FieldLabel htmlFor={null}>{t("growth.developer.endpoints.events")}</FieldLabel>
            <EventPicker
              events={events.data?.items ?? []}
              loading={events.isPending}
              all={all}
              onAllChange={setAll}
              selected={selected}
              onChange={setSelected}
              invalid={!!eventsError}
            />
            <FieldError>{eventsError}</FieldError>
          </Field>
          {!endpoint && (
            <Field>
              <div className="flex items-center justify-between gap-4 rounded-xl border px-3 py-3">
                <div className="grid gap-0.5">
                  <FieldLabel>{t("growth.developer.endpoints.activeLabel")}</FieldLabel>
                  <FieldHint>{t("growth.developer.endpoints.activeHint")}</FieldHint>
                </div>
                <FieldControl>
                  <Switch checked={active} onCheckedChange={setActive} />
                </FieldControl>
              </div>
            </Field>
          )}
          {events.isError && <InlineError title={describeError(events.error, t)} />}
          {error && !serverUrlError && <InlineError title={t("growth.developer.endpoints.saveFailed")}>{describeError(error, t)}</InlineError>}
        </form>
        <SheetFooter className="flex-row justify-end border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("growth.common.cancel")}
          </Button>
          <Button type="submit" form="endpoint-form" disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {endpoint ? t("growth.common.save") : t("growth.developer.endpoints.add")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
