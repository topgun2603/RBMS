"use client";

import * as React from "react";
import {
  BookmarkIcon,
  BookmarkPlusIcon,
  ExternalLinkIcon,
  GitMergeIcon,
  InfoIcon,
  LifeBuoyIcon,
  Loader2Icon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  ReceiptIcon,
  PackageIcon,
  SendIcon,
  StickyNoteIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldHint,
  FieldLabel,
  InitialsAvatar,
  Input,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stagger,
  StaggerItem,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from "@rbms/ui";
import { describeError, ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useFeature, useI18n, useModuleNavigate, useRouteParams } from "@rbms/web";
import { DaySeparator, Section, TagEditor } from "../components/bits";
import { AutoTextarea } from "../components/composer";
import { Markdown } from "../components/markdown";
import { PriorityPill, SlaBadge, TicketStatusPill } from "../components/pills";
import { StaffSelect, useStaffName } from "../components/staff-select";
import { FEATURES, useMe } from "../lib/access";
import { inboxLinks } from "../lib/config";
import { displayNameOf, formatPhone } from "../lib/format";
import { groupMessages } from "../lib/grouping";
import { useTicket, useTicketAssign, useTicketMerge, useTicketPriority, useTicketReply, useTicketSearch, useTicketStatus, useTicketTags } from "../lib/queries";
import { fillReply, loadSavedReplies, removeReply, storeSavedReplies, upsertReply, type SavedReply } from "../lib/saved-replies";
import { nextStatuses } from "../lib/sla";
import { istTime } from "../lib/time";
import { TICKET_PRIORITIES, type Ticket, type TicketMessage, type TicketStatus } from "../lib/types";

const KEEP = "__keep";

export default function TicketPage() {
  const { t, formatDate } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const thread = useTicket(id);
  const tk = thread.data?.ticket;

  if (thread.isError) {
    return (
      <Page>
        <PageHeading title={t("inbox.ticket.title")} back={{ href: "support", label: t("inbox.ticket.title") }} />
        <QueryError error={thread.error} onRetry={() => void thread.refetch()} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeading
        icon={LifeBuoyIcon}
        back={{ href: "support", label: t("inbox.ticket.title") }}
        title={tk ? tk.subject : <Skeleton className="h-7 w-64" />}
        description={tk ? `${tk.number} · ${t("inbox.ticket.openedOn", { date: formatDate(tk.createdAt, { dateStyle: "medium", timeStyle: "short" }) })} · ${t(`inbox.ticket.channel.${tk.channel}`)}` : undefined}
        actions={
          tk && (
            <div className="flex flex-wrap items-center gap-1.5">
              <TicketStatusPill status={tk.status} />
              <PriorityPill priority={tk.priority} />
              <SlaBadge ticket={tk} />
            </div>
          )
        }
      />
      {tk?.mergedIntoId && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-info/30 bg-info/10 px-3 py-2 text-sm text-info-ink" role="status">
          <GitMergeIcon className="size-4" aria-hidden />
          <span className="flex-1">{t("inbox.ticket.mergedInto")}</span>
          <Button asChild size="sm" variant="outline">
            <ModuleLink to={`support/${tk.mergedIntoId}`}>{t("inbox.common.open")}</ModuleLink>
          </Button>
        </div>
      )}
      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-4">
          {!thread.data ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : (
            <>
              <Thread ticket={thread.data.ticket} messages={thread.data.messages} />
              <ReplyBox ticket={thread.data.ticket} />
            </>
          )}
        </div>
        <aside className="grid content-start gap-section">{tk ? <Properties ticket={tk} /> : <Skeleton className="h-80 rounded-2xl" />}</aside>
      </div>
    </Page>
  );
}

function Thread({ ticket, messages }: { ticket: Ticket; messages: TicketMessage[] }) {
  const { t } = useI18n();
  const staffName = useStaffName();
  const items = groupMessages(
    messages.map((m) => ({ ...m, senderId: `${m.authorKind}:${m.authorId ?? ""}:${m.kind}` })),
    { myId: null, gapMs: 0 },
  );
  if (messages.length === 0) return <EmptyState compact icon={LifeBuoyIcon} title={t("inbox.ticket.noMessages")} />;
  const requester = displayNameOf(ticket.requester, t("inbox.ticket.customer"));
  return (
    <ol className="grid gap-3" aria-label={t("inbox.ticket.conversation")}>
      {items.map((it) =>
        it.kind === "day" ? (
          <li key={it.key}>
            <DaySeparator relation={it.relation} at={it.at} />
          </li>
        ) : (
          it.messages.map((m) => (
            <motion.li key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
              {m.authorKind === "system" ? (
                <p className="flex items-center justify-center gap-1.5 text-center text-meta text-muted-foreground">
                  <InfoIcon className="size-3.5" aria-hidden /> {m.body} · {istTime(m.createdAt)}
                </p>
              ) : m.kind === "note" ? (
                <article className="rounded-2xl border border-dashed border-warning/60 bg-warning/10 p-3 sm:p-4" aria-label={t("inbox.ticket.note")}>
                  <header className="mb-2 flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/25 px-2 py-0.5 font-semibold text-warning-ink">
                      <LockIcon className="size-3" aria-hidden /> {t("inbox.ticket.note")}
                    </span>
                    <span className="font-medium">{staffName(m.authorId)}</span>
                    <span className="text-muted-foreground">· {t("inbox.ticket.noteHidden")}</span>
                    <time dateTime={m.createdAt} className="ml-auto text-muted-foreground">
                      {istTime(m.createdAt)}
                    </time>
                  </header>
                  <Markdown source={m.body} />
                  <Attachments urls={m.attachments} />
                </article>
              ) : (
                <article
                  className={cn("rounded-2xl border p-3 shadow-xs sm:p-4", m.authorKind === "staff" ? "border-primary/25 bg-primary/5 sm:ml-10" : "bg-card sm:mr-10")}
                  aria-label={m.authorKind === "staff" ? t("inbox.ticket.staffReply") : t("inbox.ticket.customerMessage")}
                >
                  <header className="mb-2 flex items-center gap-2 text-xs">
                    <InitialsAvatar name={m.authorKind === "staff" ? staffName(m.authorId) : requester} size="sm" className="size-6 text-[0.625rem]" />
                    <span className="font-medium">{m.authorKind === "staff" ? staffName(m.authorId) : requester}</span>
                    <span className="text-muted-foreground">{m.authorKind === "staff" ? t("inbox.ticket.replied") : t("inbox.ticket.wrote")}</span>
                    <time dateTime={m.createdAt} className="ml-auto text-muted-foreground">
                      {istTime(m.createdAt)}
                    </time>
                  </header>
                  <Markdown source={m.body} />
                  <Attachments urls={m.attachments} />
                </article>
              )}
            </motion.li>
          ))
        ),
      )}
    </ol>
  );
}

function Attachments({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {urls.map((u) => (
        <li key={u}>
          <a href={u} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-56 items-center gap-1 truncate rounded-lg border bg-card px-2 py-1 text-xs underline-offset-2 hover:underline">
            <ExternalLinkIcon className="size-3" aria-hidden /> {decodeURIComponent(u.split("/").pop() ?? u)}
          </a>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ reply box + saved replies

function useSavedReplies() {
  const me = useMe();
  const [list, setList] = React.useState<SavedReply[]>([]);
  React.useEffect(() => {
    if (me.userId) setList(loadSavedReplies(me.userId));
  }, [me.userId]);
  const save = (next: SavedReply[]) => {
    setList(next);
    if (me.userId) storeSavedReplies(me.userId, next);
  };
  return { list, save };
}

function ReplyBox({ ticket }: { ticket: Ticket }) {
  const { t } = useI18n();
  const [kind, setKind] = React.useState<"reply" | "note">(ticket.status === "closed" ? "note" : "reply");
  const [text, setText] = React.useState("");
  const [after, setAfter] = React.useState<TicketStatus | typeof KEEP>(KEEP);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveTitle, setSaveTitle] = React.useState("");
  const reply = useTicketReply(ticket.id);
  const saved = useSavedReplies();
  const area = React.useRef<HTMLTextAreaElement | null>(null);
  const closed = ticket.status === "closed";
  const body = text.trim();
  const statuses = nextStatuses(ticket.status);

  const submit = async () => {
    if (!body || reply.isPending) return;
    if (closed && kind === "reply") return;
    try {
      await reply.mutateAsync({ kind, body, ...(after !== KEEP ? { status: after } : {}) });
      setText("");
      setAfter(KEEP);
      toast.success(kind === "note" ? t("inbox.ticket.noteAdded") : t("inbox.ticket.replySent"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const insert = (r: SavedReply) => {
    const filled = fillReply(r.body, { name: ticket.requester.name, ticket: ticket.number });
    setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${filled}` : filled));
    area.current?.focus();
  };

  return (
    <section
      aria-label={t("inbox.ticket.replyBox")}
      className={cn("rounded-2xl border p-3 shadow-elevated transition-colors sm:p-4", kind === "note" ? "border-dashed border-warning/60 bg-warning/8" : "border-card-ring bg-card")}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => v && setKind(v as "reply" | "note")} aria-label={t("inbox.ticket.replyKind")}>
          <ToggleGroupItem value="reply" disabled={closed} className="px-3">
            <SendIcon /> {t("inbox.ticket.reply")}
          </ToggleGroupItem>
          <ToggleGroupItem value="note" className="px-3">
            <StickyNoteIcon /> {t("inbox.ticket.note")}
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <BookmarkIcon /> {t("inbox.saved.title")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("inbox.saved.hint")}</DropdownMenuLabel>
            {saved.list.length === 0 && <p className="px-2 py-3 text-center text-meta text-muted-foreground">{t("inbox.saved.none")}</p>}
            {saved.list.map((r) => (
              <DropdownMenuItem key={r.id} onSelect={() => insert(r)} className="items-start">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.title}</span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">{r.body}</span>
                </span>
                <button
                  type="button"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                  aria-label={t("inbox.common.removeNamed", { name: r.title })}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    saved.save(removeReply(saved.list, r.id));
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!body} onSelect={() => (setSaveTitle(""), setSaveOpen(true))}>
              <BookmarkPlusIcon /> {t("inbox.saved.saveCurrent")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {closed && kind === "note" && <p className="mb-2 text-meta text-muted-foreground">{t("inbox.ticket.closedHint")}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="grid gap-3"
      >
        <AutoTextarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={10_000}
          maxRows={14}
          className={cn("min-h-28", kind === "note" && "border-warning/50 bg-warning/5")}
          placeholder={kind === "note" ? t("inbox.ticket.notePlaceholder") : t("inbox.ticket.replyPlaceholder")}
          aria-label={kind === "note" ? t("inbox.ticket.notePlaceholder") : t("inbox.ticket.replyPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-meta text-muted-foreground">{kind === "note" ? t("inbox.ticket.noteHint") : t("inbox.ticket.replyHint")}</p>
          {statuses.length > 0 && (
            <Select value={after} onValueChange={(v) => setAfter(v as TicketStatus | typeof KEEP)}>
              <SelectTrigger className="w-auto min-w-40" aria-label={t("inbox.ticket.thenSet")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>{kind === "reply" && ticket.status === "open" ? t("inbox.ticket.thenAuto") : t("inbox.ticket.thenKeep")}</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t("inbox.ticket.thenStatus", { status: t(`inbox.ticket.status.${s}`) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="submit" disabled={!body || reply.isPending || (closed && kind === "reply")} className={cn(kind === "note" && "bg-warning text-foreground hover:bg-warning/90")}>
            {reply.isPending ? <Loader2Icon className="animate-spin" /> : kind === "note" ? <StickyNoteIcon /> : <SendIcon />}
            {kind === "note" ? t("inbox.ticket.addNote") : t("inbox.ticket.sendReply")}
          </Button>
        </div>
      </form>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inbox.saved.saveCurrent")}</DialogTitle>
            <DialogDescription>{t("inbox.saved.saveBody")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!saveTitle.trim()) return;
              saved.save(upsertReply(saved.list, { title: saveTitle, body }));
              setSaveOpen(false);
              toast.success(t("inbox.saved.saved"));
            }}
          >
            <Field>
              <FieldLabel>{t("inbox.saved.name")}</FieldLabel>
              <FieldControl>
                <Input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} maxLength={80} autoFocus />
              </FieldControl>
              <FieldHint>{t("inbox.saved.varsHint")}</FieldHint>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
                {t("inbox.common.cancel")}
              </Button>
              <Button type="submit" disabled={!saveTitle.trim()}>
                {t("inbox.common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ------------------------------------------------------------------ side panel

function Properties({ ticket }: { ticket: Ticket }) {
  const { t, formatDate } = useI18n();
  const status = useTicketStatus(ticket.id);
  const priority = useTicketPriority(ticket.id);
  const assign = useTicketAssign(ticket.id);
  const tags = useTicketTags(ticket.id);
  const ordersOn = useFeature(FEATURES.orders);
  const invoicesOn = useFeature(FEATURES.invoices);
  const [merge, setMerge] = React.useState(false);
  const onErr = (err: unknown) => toast.error(describeError(err, t));
  const options = [ticket.status, ...nextStatuses(ticket.status)];
  const r = ticket.requester;
  const related = ticket.related;
  const relatedHref = related ? (related.type === "order" ? (ordersOn ? inboxLinks().order(related.id) : null) : invoicesOn ? inboxLinks().invoice(related.id) : null) : null;

  return (
    <Stagger className="grid gap-4">
      <StaggerItem>
        <Section icon={LifeBuoyIcon} title={t("inbox.ticket.properties")}>
          <Field>
            <FieldLabel>{t("inbox.ticket.col.status")}</FieldLabel>
            <Select value={ticket.status} onValueChange={(v) => status.mutate(v as TicketStatus, { onError: onErr })} disabled={status.isPending || options.length === 1 || !!ticket.mergedIntoId}>
              <FieldControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {options.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`inbox.ticket.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ticket.status === "closed" && <FieldHint>{t("inbox.ticket.closedFinal")}</FieldHint>}
          </Field>
          <Field>
            <FieldLabel>{t("inbox.ticket.priority")}</FieldLabel>
            <Select value={ticket.priority} onValueChange={(v) => priority.mutate(v as Ticket["priority"], { onError: onErr })} disabled={priority.isPending}>
              <FieldControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {TICKET_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`inbox.ticket.priority.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t("inbox.ticket.assignee")}</FieldLabel>
            <FieldControl>
              <StaffSelect value={ticket.assigneeId} onChange={(v) => assign.mutate(v, { onError: onErr })} disabled={assign.isPending} />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel htmlFor={null}>{t("inbox.ticket.tags")}</FieldLabel>
            <TagEditor value={ticket.tags} onChange={(next) => tags.mutate(next, { onError: onErr })} label={t("inbox.wa.addTag")} placeholder={t("inbox.wa.addTag")} disabled={tags.isPending} />
          </Field>
        </Section>
      </StaggerItem>

      <StaggerItem>
        <Section icon={UserRoundIcon} title={t("inbox.ticket.customer")}>
          <div className="flex items-center gap-3">
            <InitialsAvatar name={displayNameOf(r, "?")} />
            <div className="min-w-0">
              <p className="truncate font-medium">{displayNameOf(r, t("inbox.ticket.customer"))}</p>
              {!r.userId && <p className="text-meta text-muted-foreground">{t("inbox.ticket.guest")}</p>}
            </div>
          </div>
          {r.phone && (
            <a href={`tel:${r.phone}`} className="flex items-center gap-2 text-sm hover:underline">
              <PhoneIcon className="size-4 text-muted-foreground" aria-hidden /> {formatPhone(r.phone)}
            </a>
          )}
          {r.email && (
            <a href={`mailto:${r.email}`} className="flex items-center gap-2 truncate text-sm hover:underline">
              <MailIcon className="size-4 text-muted-foreground" aria-hidden /> {r.email}
            </a>
          )}
          {related && (
            <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm">
              {related.type === "order" ? <PackageIcon className="size-4 text-primary" aria-hidden /> : <ReceiptIcon className="size-4 text-primary" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{t(`inbox.ticket.related.${related.type}`)}</span>
              {relatedHref ? (
                <ModuleLink href={relatedHref} className="text-xs font-medium text-primary hover:underline">
                  {t("inbox.common.open")}
                </ModuleLink>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">{related.id.slice(0, 8)}</span>
              )}
            </div>
          )}
        </Section>
      </StaggerItem>

      <StaggerItem>
        <Section icon={InfoIcon} title={t("inbox.ticket.sla")}>
          <dl className="grid gap-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("inbox.ticket.firstReplyDue")}</dt>
              <dd>{ticket.slaDueAt ? formatDate(ticket.slaDueAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("inbox.ticket.firstReply")}</dt>
              <dd>{ticket.firstResponseAt ? formatDate(ticket.firstResponseAt, { dateStyle: "medium", timeStyle: "short" }) : t("inbox.ticket.notYet")}</dd>
            </div>
            {ticket.resolvedAt && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("inbox.ticket.resolved")}</dt>
                <dd>{formatDate(ticket.resolvedAt, { dateStyle: "medium", timeStyle: "short" })}</dd>
              </div>
            )}
          </dl>
          <SlaBadge ticket={ticket} />
        </Section>
      </StaggerItem>

      {!ticket.mergedIntoId && ticket.status !== "closed" && (
        <StaggerItem>
          <Button variant="outline" className="w-full" onClick={() => setMerge(true)}>
            <GitMergeIcon /> {t("inbox.ticket.merge")}
          </Button>
          <MergeDialog ticket={ticket} open={merge} onOpenChange={setMerge} />
        </StaggerItem>
      )}
    </Stagger>
  );
}

function MergeDialog({ ticket, open, onOpenChange }: { ticket: Ticket; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const [q, setQ] = React.useState("");
  const [target, setTarget] = React.useState<Ticket | null>(null);
  const debounced = useDebounced(q.trim(), 300);
  const search = useTicketSearch(debounced, open);
  const merge = useTicketMerge(ticket.id);
  const candidates = (search.data ?? []).filter((x) => x.id !== ticket.id && !x.mergedIntoId);
  React.useEffect(() => {
    if (!open) {
      setQ("");
      setTarget(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("inbox.ticket.mergeTitle", { number: ticket.number })}</DialogTitle>
          <DialogDescription>{t("inbox.ticket.mergeBody")}</DialogDescription>
        </DialogHeader>
        <SearchField value={q} onChange={setQ} placeholder={t("inbox.ticket.mergeSearch")} size="default" />
        <ul className="max-h-64 overflow-y-auto" role="listbox" aria-label={t("inbox.ticket.mergeInto")}>
          {search.isPending && <Skeleton className="h-12" />}
          {!search.isPending && candidates.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">{t("inbox.common.noMatch")}</li>}
          {candidates.map((x) => (
            <li key={x.id} role="option" aria-selected={target?.id === x.id}>
              <button
                type="button"
                onClick={() => setTarget(x)}
                className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", target?.id === x.id && "bg-primary/10 ring-1 ring-primary/30")}
              >
                <span className="font-mono text-xs text-muted-foreground">{x.number}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{x.subject}</span>
                <TicketStatusPill status={x.status} />
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("inbox.common.cancel")}
          </Button>
          <Button
            disabled={!target || merge.isPending}
            onClick={async () => {
              if (!target) return;
              try {
                await merge.mutateAsync(target.id);
                toast.success(t("inbox.ticket.merged", { number: target.number }));
                onOpenChange(false);
                navigate(`support/${target.id}`);
              } catch (err) {
                toast.error(describeError(err, t));
              }
            }}
          >
            {merge.isPending ? <Loader2Icon className="animate-spin" /> : <GitMergeIcon />}
            {target ? t("inbox.ticket.mergeInto", { number: target.number }) : t("inbox.ticket.merge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
