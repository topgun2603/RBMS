"use client";

import * as React from "react";
import { Settings2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { describeError, QueryError, useI18n } from "@rbms/web";
import { AccountingPage, Panel, TableSkeleton } from "../components/accounting/parts";
import { ACC_TDS, pct, useSaveParty, useSaveTdsSettings, useTdsParties, useTdsSettings, type TdsParty, type TdsSection } from "../lib/accounting-b";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";

const NONE = "none";
const DEDUCTEE = ["individual", "huf", "company", "firm", "other"] as const;

/** TDS / TCS settings: switch on, TAN, the sections you use and their rates, and the PAN of suppliers and customers. */
export default function AccountingTdsSettingsPage() {
  const { t } = useI18n();
  const canTds = useHasPermission(ACC_TDS);
  const s = useTdsSettings();
  const save = useSaveTdsSettings();
  const [tan, setTan] = React.useState("");
  const [name, setName] = React.useState("");
  const [person, setPerson] = React.useState("");
  const [edit, setEdit] = React.useState<TdsSection | null>(null);
  React.useEffect(() => {
    if (!s.data) return;
    setTan(s.data.tan ?? "");
    setName(s.data.deductorName ?? "");
    setPerson(s.data.responsiblePerson ?? "");
  }, [s.data]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await save.mutateAsync(body);
      toast.success(t("billing.acctb.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <AccountingPage title={t("billing.acctb.tds.settingsTitle")} description={t("billing.acctb.tds.settingsSubtitle")} icon={Settings2Icon} needsSetup={false}>
      {s.isError && !s.data ? (
        <QueryError error={s.error} onRetry={() => void s.refetch()} />
      ) : !s.data ? (
        <TableSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-section">
          <Card>
            <CardContent className="grid gap-4">
              {(
                [
                  ["enabled", "billing.acctb.tds.useTds", "billing.acctb.tds.useTdsHint"],
                  ["buyerTurnoverAbove10Cr", "billing.acctb.tds.turnover", "billing.acctb.tds.turnoverHint"],
                  ["tcsEnabled", "billing.acctb.tds.useTcs", "billing.acctb.tds.useTcsHint"],
                ] as const
              ).map(([key, label, hint]) => (
                <div key={key} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                  <div className="min-w-0">
                    <p className="font-medium">{t(label)}</p>
                    <p className="text-meta text-muted-foreground">{t(hint)}</p>
                  </div>
                  <Switch checked={!!s.data[key]} disabled={!canTds || save.isPending} onCheckedChange={(v) => void patch({ [key]: v })} aria-label={t(label)} />
                </div>
              ))}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ts-tan">{t("billing.acctb.tds.tan")}</Label>
                  <Input id="ts-tan" maxLength={10} value={tan} disabled={!canTds} onChange={(e) => setTan(e.target.value.toUpperCase())} placeholder="CHEA12345B" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ts-name">{t("billing.acctb.tds.deductorName")}</Label>
                  <Input id="ts-name" maxLength={120} value={name} disabled={!canTds} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ts-person">{t("billing.acctb.tds.responsible")}</Label>
                  <Input id="ts-person" maxLength={120} value={person} disabled={!canTds} onChange={(e) => setPerson(e.target.value)} />
                </div>
              </div>
              {canTds && (
                <div className="flex justify-end">
                  <Button onClick={() => void patch({ tan: tan.trim() || null, deductorName: name.trim() || null, responsiblePerson: person.trim() || null })} disabled={save.isPending}>
                    {t("billing.common.save")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div>
            <p className="mb-1 font-medium">{t("billing.acctb.tds.sections")}</p>
            <p className="mb-3 text-meta text-muted-foreground">{t("billing.acctb.tds.sectionsHint")}</p>
            <Panel>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.acctb.tds.section")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.tds.rate")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.tds.noPanRate")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.tds.limits")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.data.sections.map((x) => (
                      <TableRow key={x.key} className={x.enabled ? undefined : "opacity-60"}>
                        <TableCell className="min-w-64 max-w-96 whitespace-normal">
                          <span className="block font-medium">
                            {x.section} · {x.label}
                          </span>
                          <span className="block text-meta text-muted-foreground">{x.note ?? x.plain}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct(x.rate)}
                          {x.rateOther !== x.rate && <span className="block text-meta text-muted-foreground">{t("billing.acctb.tds.others", { rate: pct(x.rateOther) })}</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{pct(x.noPanRate)}</TableCell>
                        <TableCell className="text-right text-meta">
                          {x.single ? <span className="block">{t("billing.acctb.tds.perPayment", { amount: money(x.single) })}</span> : null}
                          {x.annual ? <span className="block">{t("billing.acctb.tds.perYear", { amount: money(x.annual) })}</span> : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="flex items-center justify-end gap-2">
                            {x.enabled ? <StatusPill tone="success">{t("billing.acctb.on")}</StatusPill> : <StatusPill tone="neutral">{t("billing.acctb.off")}</StatusPill>}
                            {canTds && (
                              <Button size="sm" variant="outline" onClick={() => setEdit(x)}>
                                {t("billing.common.edit")}
                              </Button>
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          </div>

          <Parties canTds={canTds} sections={s.data.sections} />
        </div>
      )}
      <SectionDialog section={edit} onClose={() => setEdit(null)} />
    </AccountingPage>
  );
}

function SectionDialog({ section, onClose }: { section: TdsSection | null; onClose: () => void }) {
  const { t } = useI18n();
  const save = useSaveTdsSettings();
  const [enabled, setEnabled] = React.useState(true);
  const [rate, setRate] = React.useState("");
  const [rateOther, setRateOther] = React.useState("");
  const [noPan, setNoPan] = React.useState("");
  React.useEffect(() => {
    if (!section) return;
    setEnabled(section.enabled);
    setRate(String(section.rate / 100));
    setRateOther(String(section.rateOther / 100));
    setNoPan(String(section.noPanRate / 100));
  }, [section]);
  const bp = (s: string) => Math.round(Number(s) * 100);
  const submit = async () => {
    if (!section) return;
    try {
      await save.mutateAsync({ overrides: { [section.key]: { enabled, rate: bp(rate), rateOther: bp(rateOther), noPanRate: bp(noPan) } } });
      toast.success(t("billing.acctb.saved"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const valid = [rate, rateOther, noPan].every((x) => x !== "" && Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 50);
  return (
    <Dialog open={!!section} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>
            {section?.section} · {section?.label}
          </DialogTitle>
          <DialogDescription>{t("billing.acctb.tds.sectionEditHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <span className="font-medium">{t("billing.acctb.tds.useSection")}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("billing.acctb.tds.useSection")} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ["s-r", "billing.acctb.tds.rateInd", rate, setRate],
                ["s-o", "billing.acctb.tds.rateOth", rateOther, setRateOther],
                ["s-n", "billing.acctb.tds.noPanRate", noPan, setNoPan],
              ] as const
            ).map(([id, label, v, set]) => (
              <div key={id} className="grid gap-1.5">
                <Label htmlFor={id}>{t(label)}</Label>
                <Input id={id} inputMode="decimal" value={v} onChange={(e) => set(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid || save.isPending}>
            {t("billing.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Parties({ canTds, sections }: { canTds: boolean; sections: TdsSection[] }) {
  const { t } = useI18n();
  const [type, setType] = React.useState<"supplier" | "customer">("supplier");
  const [q, setQ] = React.useState("");
  const list = useTdsParties(type, q);
  const [edit, setEdit] = React.useState<TdsParty | null>(null);
  return (
    <div>
      <p className="mb-1 font-medium">{t("billing.acctb.tds.panTitle")}</p>
      <p className="mb-3 text-meta text-muted-foreground">{t("billing.acctb.tds.panHint")}</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <ChipGroup
          size="sm"
          aria-label={t("billing.acctb.tds.partyType")}
          value={type}
          onChange={setType}
          options={[
            { value: "supplier" as const, label: t("billing.acctb.tds.suppliers") },
            { value: "customer" as const, label: t("billing.acctb.tds.customers") },
          ]}
        />
        <Input className="w-full sm:ml-auto sm:w-64" placeholder={t("billing.acctb.tds.searchParty")} aria-label={t("billing.acctb.tds.searchParty")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.isPending ? (
        <TableSkeleton />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.acctb.tds.party")}</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>{t("billing.acctb.tds.deducteeType")}</TableHead>
                  <TableHead>{t("billing.acctb.tds.defaultSection")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-56">
                      <span className="block truncate font-medium">{p.name}</span>
                      {p.gstin && <span className="block font-mono text-xs text-muted-foreground">{p.gstin}</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.effectivePan ?? <StatusPill tone="warning">{t("billing.acctb.tds.noPan")}</StatusPill>}
                      {!p.pan && p.panFromGstin && <span className="block font-sans text-meta text-muted-foreground">{t("billing.acctb.tds.fromGstin")}</span>}
                    </TableCell>
                    <TableCell>{p.deducteeType ? t(`billing.acctb.deductee.${p.deducteeType}`) : "-"}</TableCell>
                    <TableCell>{p.defaultSection ? (sections.find((s) => s.key === p.defaultSection)?.section ?? p.defaultSection) : "-"}</TableCell>
                    <TableCell className="text-right">
                      {canTds && (
                        <Button size="sm" variant="outline" onClick={() => setEdit(p)}>
                          {t("billing.common.edit")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!list.data?.length && <p className="p-6 text-center text-muted-foreground">{t("billing.acctb.tds.noParties")}</p>}
        </Panel>
      )}
      <PartyDialog party={edit} type={type} sections={sections} onClose={() => setEdit(null)} />
    </div>
  );
}

function PartyDialog({ party, type, sections, onClose }: { party: TdsParty | null; type: "supplier" | "customer"; sections: TdsSection[]; onClose: () => void }) {
  const { t } = useI18n();
  const save = useSaveParty();
  const [pan, setPan] = React.useState("");
  const [dt, setDt] = React.useState<string>(NONE);
  const [sec, setSec] = React.useState<string>(NONE);
  const [lower, setLower] = React.useState("");
  const [certNo, setCertNo] = React.useState("");
  const [certUntil, setCertUntil] = React.useState("");
  React.useEffect(() => {
    if (!party) return;
    setPan(party.pan ?? party.panFromGstin ?? "");
    setDt(party.deducteeType ?? NONE);
    setSec(party.defaultSection ?? NONE);
    setLower(party.lowerRate !== null ? String(party.lowerRate / 100) : "");
    setCertNo(party.certificateNo ?? "");
    setCertUntil(party.certificateUntil ?? "");
  }, [party]);
  const panOk = !pan || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  const submit = async () => {
    if (!party) return;
    try {
      await save.mutateAsync({
        type,
        id: party.id,
        body: { pan: pan || null, deducteeType: dt === NONE ? null : dt, defaultSection: sec === NONE ? null : sec, lowerRate: lower ? Math.round(Number(lower) * 100) : null, certificateNo: certNo || null, certificateUntil: certUntil || null },
      });
      toast.success(t("billing.acctb.saved"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!party} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{party?.name}</DialogTitle>
          <DialogDescription>{t("billing.acctb.tds.partyEditHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pt-pan">PAN</Label>
            <Input id="pt-pan" maxLength={10} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} aria-invalid={!panOk} />
            {!panOk && <p className="text-meta text-danger-ink">{t("billing.acctb.tds.panBad")}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pt-dt">{t("billing.acctb.tds.deducteeType")}</Label>
            <Select value={dt} onValueChange={setDt}>
              <SelectTrigger id="pt-dt" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("billing.acctb.tds.fromPan")}</SelectItem>
                {DEDUCTEE.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t(`billing.acctb.deductee.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pt-sec">{t("billing.acctb.tds.defaultSection")}</Label>
            <Select value={sec} onValueChange={setSec}>
              <SelectTrigger id="pt-sec" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("billing.acctb.tds.noDefault")}</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.section} · {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pt-lr">{t("billing.acctb.tds.lowerRate")}</Label>
              <Input id="pt-lr" inputMode="decimal" value={lower} onChange={(e) => setLower(e.target.value.replace(/[^\d.]/g, ""))} placeholder="%" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pt-cn">{t("billing.acctb.tds.certNo")}</Label>
              <Input id="pt-cn" maxLength={40} value={certNo} onChange={(e) => setCertNo(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pt-cu">{t("billing.acctb.tds.certUntil")}</Label>
              <Input id="pt-cu" type="date" value={certUntil} onChange={(e) => setCertUntil(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!panOk || save.isPending}>
            {t("billing.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
