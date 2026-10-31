"use client";

import * as React from "react";
import {
  KeyRoundIcon,
  Loader2Icon,
  MonitorSmartphoneIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react";
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from "@rbms/ui";
import {
  ConfirmDialog,
  describeError,
  Page,
  PageHeading,
  QueryError,
  SettingsNav,
  useFeature,
  useI18n,
  useMyBranches,
  usePermission,
} from "@rbms/web";
import { QrImage } from "../components/qr-image";
import { POS_FEATURES, POS_PERMISSIONS } from "../lib/access";
import { displayPairingCode } from "../lib/pairing";
import { formatCountdown, lockSecondsLeft } from "../lib/pin";
import { useTerminalActions, useTerminals, type TerminalInput } from "../lib/terminal-api";
import type { Pairing, Terminal, TerminalRole } from "../lib/terminal-types";

/**
 * Settings → POS terminals (feature pos.terminals, permission pos.devices): the shop's counters and weighing stations,
 * each with its paired device; create one to get a pairing code + QR for the device; re-issue, unpair, edit, delete.
 */
export default function TerminalsPage() {
  const { t } = useI18n();
  const list = useTerminals();
  const actions = useTerminalActions();
  const weighingOn = useFeature(POS_FEATURES.weighing);
  const allowed = usePermission(POS_PERMISSIONS.devices);
  const branches = useMyBranches();
  const branchName = React.useCallback((id: string | null) => (id ? (branches.data?.items.find((b) => b.id === id)?.name ?? null) : null), [branches.data]);

  const [editing, setEditing] = React.useState<{ terminal: Terminal | null } | null>(null);
  const [pairing, setPairing] = React.useState<{ terminal: Terminal; pairing: Pairing } | null>(null);
  const [unpairing, setUnpairing] = React.useState<Terminal | null>(null);
  const [removing, setRemoving] = React.useState<Terminal | null>(null);

  const data = list.data;
  const atLimit = !!data && data.limit !== null && data.total >= data.limit;

  const reissue = async (term: Terminal) => {
    try {
      const p = await actions.reissue.mutateAsync(term.id);
      setPairing({ terminal: term, pairing: p });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const add = (
    <Button size="lg" onClick={() => setEditing({ terminal: null })} disabled={atLimit} title={atLimit ? t("pos.terminals.atLimit") : undefined}>
      <PlusIcon /> {t("pos.terminals.add")}
    </Button>
  );

  return (
    <Page>
      <SettingsNav />
      <PageHeading icon={MonitorSmartphoneIcon} title={t("pos.terminals.title")} description={t("pos.terminals.subtitle")} />
      {!allowed ? (
        <Alert variant="warning">
          <AlertTitle>{t("pos.terminals.noAccess")}</AlertTitle>
        </Alert>
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {data ? (
              <p className="text-sm text-muted-foreground" data-terminal-limit="">
                {data.limit === null ? t("pos.terminals.countUnlimited", { count: data.total }) : t("pos.terminals.count", { count: data.total, limit: data.limit })}
                {atLimit && <span className="ml-2 font-medium text-warning-ink">{t("pos.terminals.atLimit")}</span>}
              </p>
            ) : (
              <Skeleton className="h-4 w-40" />
            )}
            {add}
          </div>

          {list.isPending ? (
            <Card className="gap-0 divide-y py-0">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-4">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                </div>
              ))}
            </Card>
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={MonitorSmartphoneIcon} title={t("pos.terminals.emptyTitle")} description={t("pos.terminals.emptyBody")} action={add} />
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <ul className="divide-y" aria-label={t("pos.terminals.title")}>
                {data.items.map((term) => (
                  <TerminalRow
                    key={term.id}
                    terminal={term}
                    branch={branchName(term.branchId)}
                    onEdit={() => setEditing({ terminal: term })}
                    onCode={() => void reissue(term)}
                    onUnpair={() => setUnpairing(term)}
                    onDelete={() => setRemoving(term)}
                    busy={actions.reissue.isPending && actions.reissue.variables === term.id}
                  />
                ))}
              </ul>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">{t("pos.terminals.howTo")}</p>
        </div>
      )}

      <TerminalDialog
        open={!!editing}
        terminal={editing?.terminal ?? null}
        weighingOn={weighingOn}
        branches={branches.data?.items ?? []}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          if (editing?.terminal) {
            await actions.update.mutateAsync({ id: editing.terminal.id, ...input });
            toast.success(t("pos.terminals.saved"));
            setEditing(null);
          } else {
            const r = await actions.create.mutateAsync(input);
            setEditing(null);
            setPairing(r);
          }
        }}
      />
      <PairingDialog value={pairing} onClose={() => setPairing(null)} onReissue={(term) => void reissue(term)} reissuing={actions.reissue.isPending} />
      <ConfirmDialog
        open={!!unpairing}
        onOpenChange={(o) => !o && setUnpairing(null)}
        title={t("pos.terminals.unpairTitle", { name: unpairing?.name ?? "" })}
        description={t("pos.terminals.unpairBody")}
        confirmLabel={t("pos.terminals.unpair")}
        onConfirm={async () => {
          if (!unpairing) return;
          try {
            await actions.unpair.mutateAsync(unpairing.id);
            toast.success(t("pos.terminals.unpaired", { name: unpairing.name }));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("pos.terminals.deleteTitle", { name: removing?.name ?? "" })}
        description={t("pos.terminals.deleteBody")}
        confirmLabel={t("pos.terminals.delete")}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await actions.remove.mutateAsync(removing.id);
            toast.success(t("pos.terminals.deleted", { name: removing.name }));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}

function useAgo() {
  const { locale } = useI18n();
  return React.useCallback(
    (iso: string | null) => {
      if (!iso) return null;
      const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
      const rtf = new Intl.RelativeTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { numeric: "auto" });
      const a = Math.abs(s);
      if (a < 60) return rtf.format(Math.round(s), "second");
      if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
      if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
      return rtf.format(Math.round(s / 86400), "day");
    },
    [locale],
  );
}

function TerminalRow({
  terminal: term,
  branch,
  onEdit,
  onCode,
  onUnpair,
  onDelete,
  busy,
}: {
  terminal: Terminal;
  branch: string | null;
  onEdit: () => void;
  onCode: () => void;
  onUnpair: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const ago = useAgo();
  const RoleIcon = term.role === "weighing" ? ScaleIcon : ScanBarcodeIcon;
  const device = term.device ? [term.device.name, term.device.model].filter(Boolean).join(" · ") || term.device.platform : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:flex-nowrap sm:px-5" data-terminal={term.name}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <RoleIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{term.name}</span>
          <Badge variant="muted">{t(term.role === "weighing" ? "pos.terminals.roleWeighing" : "pos.terminals.rolePos")}</Badge>
          {branch && <Badge variant="outline">{branch}</Badge>}
          {term.pairingPending && <Badge variant="warning">{t("pos.terminals.pending")}</Badge>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-meta text-muted-foreground">
          {term.paired ? (
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-success" aria-hidden /> {t("pos.terminals.pairedWith", { device: device ?? "" })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden /> {t("pos.terminals.notPaired")}
            </span>
          )}
          {term.lastSeenAt && <span>{t("pos.terminals.lastSeen", { when: ago(term.lastSeenAt) ?? "" })}</span>}
          <span>
            {t("pos.terminals.settingsLine", { width: term.settings.printerWidth, minutes: term.settings.lockAfterMinutes })}
            {term.settings.autoPrint ? ` · ${t("pos.terminals.autoPrintOn")}` : ""}
          </span>
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" onClick={onCode} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />} {term.paired ? t("pos.terminals.pairNew") : t("pos.terminals.code")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("pos.terminals.actionsFor", { name: term.name })}>
              <MoreVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem className="h-10" onSelect={onEdit}>
              <PencilIcon /> {t("pos.terminals.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem className="h-10" onSelect={onCode}>
              <RefreshCwIcon /> {t("pos.terminals.reissue")}
            </DropdownMenuItem>
            {term.paired && (
              <DropdownMenuItem className="h-10" onSelect={onUnpair}>
                <UnplugIcon /> {t("pos.terminals.unpair")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className="h-10" onSelect={onDelete}>
              <Trash2Icon /> {t("pos.terminals.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

const NONE = "__none";

function TerminalDialog({
  open,
  terminal,
  weighingOn,
  branches,
  onClose,
  onSave,
}: {
  open: boolean;
  terminal: Terminal | null;
  weighingOn: boolean;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSave: (input: TerminalInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<TerminalRole>("pos");
  const [branchId, setBranchId] = React.useState<string>(NONE);
  const [width, setWidth] = React.useState<"58" | "80">("80");
  const [autoPrint, setAutoPrint] = React.useState(false);
  const [lockAfter, setLockAfter] = React.useState("5");
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(terminal?.name ?? "");
    setRole(terminal?.role ?? "pos");
    setBranchId(terminal?.branchId ?? NONE);
    setWidth(terminal?.settings.printerWidth === 58 ? "58" : "80");
    setAutoPrint(terminal?.settings.autoPrint ?? false);
    setLockAfter(String(terminal?.settings.lockAfterMinutes ?? 5));
    setTouched(false);
    setError(null);
  }, [open, terminal]);

  const clean = name.trim().replace(/\s+/g, " ");
  const nameOk = clean.length >= 1 && clean.length <= 40;
  const lock = Number(lockAfter);
  const lockOk = Number.isInteger(lock) && lock >= 1 && lock <= 60;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!nameOk || !lockOk) return;
    setSaving(true);
    try {
      await onSave({
        name: clean,
        role,
        branchId: branchId === NONE ? null : branchId,
        settings: { printerWidth: width === "58" ? 58 : 80, autoPrint, lockAfterMinutes: lock },
      });
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{terminal ? t("pos.terminals.editTitle", { name: terminal.name }) : t("pos.terminals.addTitle")}</DialogTitle>
          <DialogDescription>{t("pos.terminals.formBody")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field invalid={touched && !nameOk}>
            <FieldLabel>{t("pos.terminals.name")}</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={role === "weighing" ? t("pos.terminals.namePlaceholderWeighing") : t("pos.terminals.namePlaceholder")} autoFocus />
            {touched && !nameOk ? <FieldError>{t("pos.terminals.nameInvalid")}</FieldError> : <FieldHint>{t("pos.terminals.nameHint")}</FieldHint>}
          </Field>
          <Field>
            <FieldLabel>{t("pos.terminals.role")}</FieldLabel>
            <Select value={role} onValueChange={(v) => setRole(v as TerminalRole)}>
              <SelectTrigger aria-label={t("pos.terminals.role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pos">{t("pos.terminals.rolePos")}</SelectItem>
                {(weighingOn || terminal?.role === "weighing") && <SelectItem value="weighing">{t("pos.terminals.roleWeighing")}</SelectItem>}
              </SelectContent>
            </Select>
            {!weighingOn && <FieldHint>{t("pos.terminals.weighingOff")}</FieldHint>}
          </Field>
          {branches.length > 0 && (
            <Field>
              <FieldLabel>{t("pos.terminals.branch")}</FieldLabel>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger aria-label={t("pos.terminals.branch")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("pos.terminals.anyBranch")}</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>{t("pos.terminals.printer")}</FieldLabel>
              <Select value={width} onValueChange={(v) => setWidth(v as "58" | "80")}>
                <SelectTrigger aria-label={t("pos.terminals.printer")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="58">{t("pos.terminals.mm", { mm: 58 })}</SelectItem>
                  <SelectItem value="80">{t("pos.terminals.mm", { mm: 80 })}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={touched && !lockOk}>
              <FieldLabel>{t("pos.terminals.lockAfter")}</FieldLabel>
              <Input value={lockAfter} onChange={(e) => setLockAfter(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" />
              {touched && !lockOk ? <FieldError>{t("pos.terminals.lockInvalid")}</FieldError> : <FieldHint>{t("pos.terminals.lockHint")}</FieldHint>}
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <span className="grid">
              <span className="text-sm font-medium">{t("pos.terminals.autoPrint")}</span>
              <span className="text-xs text-muted-foreground">{t("pos.terminals.autoPrintHint")}</span>
            </span>
            <Switch checked={autoPrint} onCheckedChange={setAutoPrint} aria-label={t("pos.terminals.autoPrint")} />
          </label>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("pos.common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2Icon className="animate-spin" />} {terminal ? t("pos.common.save") : t("pos.terminals.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PairingDialog({
  value,
  onClose,
  onReissue,
  reissuing,
}: {
  value: { terminal: Terminal; pairing: Pairing } | null;
  onClose: () => void;
  onReissue: (t: Terminal) => void;
  reissuing: boolean;
}) {
  const { t } = useI18n();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!value) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [value]);
  const left = value ? lockSecondsLeft(Date.parse(value.pairing.expiresAt), now) : 0;
  const expired = !!value && left === 0;
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("pos.terminals.pairTitle", { name: value?.terminal.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("pos.terminals.pairBody")}</DialogDescription>
        </DialogHeader>
        {value && (
          <div className="grid justify-items-center gap-4 text-center">
            <p className="font-mono text-4xl font-bold tracking-[0.15em] tabular-nums select-all sm:text-5xl" data-pairing-code="" aria-label={t("pos.terminals.codeLabel")}>
              {displayPairingCode(value.pairing.code)}
            </p>
            <div className={expired ? "opacity-30" : undefined}>
              <QrImage value={value.pairing.qr} size={200} alt={t("pos.terminals.qrAlt", { name: value.terminal.name })} />
            </div>
            <p className={expired ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"} role="status">
              {expired ? t("pos.terminals.codeExpired") : t("pos.terminals.expiresIn", { time: formatCountdown(left) })}
            </p>
            <ol className="grid list-decimal gap-1 pl-5 text-left text-sm text-muted-foreground">
              <li>{t("pos.terminals.pairStep1")}</li>
              <li>{t("pos.terminals.pairStep2")}</li>
            </ol>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => value && onReissue(value.terminal)} disabled={reissuing}>
            {reissuing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("pos.terminals.reissue")}
          </Button>
          <Button type="button" onClick={onClose}>
            {t("pos.common.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
