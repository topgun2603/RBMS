"use client";

import * as React from "react";
import { BanknoteIcon, CheckCircle2Icon, Loader2Icon, PlugZapIcon, PrinterIcon } from "lucide-react";
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Textarea,
  toast,
} from "@srirealtime/ui";
import { clearDeviceKeys, detectSupport, openDrawerDirect, pairPrinter, printTestPage, resolveConfig, type DirectResult, type PrinterConfig, type TransportKind, type TransportSupport } from "@srirealtime/receipt-print";
import { describeError, Page, PageHeading, SettingsNav, useI18n, useTenantSlug } from "@srirealtime/web";
import { failureKey, saveShopPrinting, usePrinterConfig } from "../lib/printing";
import { configFromForm, DEVICE_KEYS, formFromConfig, LAYOUT_KEYS, pickKeys, validateForm, withPaperWidth, type PrintForm } from "../lib/printing-form";

const TYPES: TransportKind[] = ["none", "usb", "serial", "bluetooth", "bridge"];

/**
 * Settings → Printing: the direct thermal printer and cash drawer of THIS computer (type, pairing, test) and the
 * receipt layout (this computer, or the shop default every counter starts from). Nothing here was verified against a
 * physical printer by the developers; use Test print on yours (docs/printing.md).
 */
export default function PrintingPage() {
  const { t, locale } = useI18n();
  // Settings pages render outside the counter (no PosProvider): the shop comes from the host.
  const tenant = useTenantSlug() ?? null;
  const printer = usePrinterConfig(tenant);
  const [form, setForm] = React.useState<PrintForm | null>(null);
  const [support, setSupport] = React.useState<TransportSupport | null>(null);
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState<null | "connect" | "test" | "drawer" | "shop">(null);
  const [connected, setConnected] = React.useState<string | null>(null);
  const [testNote, setTestNote] = React.useState(false);

  React.useEffect(() => setSupport(detectSupport()), []);
  // Fill the form once the shop defaults have arrived (and again after "use the shop default here").
  const loaded = React.useRef(false);
  React.useEffect(() => {
    if (!printer.loading && !loaded.current) {
      loaded.current = true;
      setForm(formFromConfig(printer.config));
    }
  }, [printer.loading, printer.config]);

  if (!form || !support) {
    return (
      <Page>
        <SettingsNav />
        <PageHeading icon={PrinterIcon} title={t("pos.printing.title")} description={t("pos.printing.subtitle")} />
        <Skeleton className="h-64 w-full rounded-xl" />
      </Page>
    );
  }

  const set = <K extends keyof PrintForm>(key: K, value: PrintForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const errors = validateForm(form);
  const valid = Object.keys(errors).length === 0;
  const draft = () => resolveConfig({}, { ...printer.config, ...configFromForm(form) });
  const supported = (k: TransportKind) => k === "none" || support[k];
  const fail = (res: Extract<DirectResult, { ok: false }>) => toast.error(t(failureKey(res.code)));

  const saveDevice = (keys: readonly (keyof PrinterConfig)[], message: string) => {
    if (!valid) return setTouched(true);
    printer.save(pickKeys(configFromForm(form), keys));
    toast.success(message);
  };

  const connect = async () => {
    if (!valid) return setTouched(true);
    setBusy("connect");
    try {
      const cfg = draft();
      printer.save(pickKeys(configFromForm(form), DEVICE_KEYS));
      const res = await pairPrinter(cfg, { interactive: true });
      if (res.ok) {
        setConnected(res.paired?.name ?? cfg.deviceName ?? "");
        if (res.paired) printer.save({ deviceHint: res.paired.id, deviceName: res.paired.name });
      } else fail(res);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!valid) return setTouched(true);
    setBusy("test");
    try {
      const cfg = draft();
      printer.save(pickKeys(configFromForm(form), DEVICE_KEYS));
      const res = await printTestPage(cfg, "Test print", { interactive: true, locale: locale === "ta" ? "ta" : "en" });
      if (res.ok) {
        setTestNote(true);
        if (res.paired) {
          setConnected(res.paired.name);
          printer.save({ deviceHint: res.paired.id, deviceName: res.paired.name });
        }
        toast.success(t("pos.printing.testOk"));
      } else fail(res);
    } finally {
      setBusy(null);
    }
  };

  const drawer = async () => {
    if (!valid) return setTouched(true);
    setBusy("drawer");
    try {
      const res = await openDrawerDirect(draft(), { interactive: true });
      if (res.ok) toast.success(t("pos.drawer.opened"));
      else fail(res);
    } finally {
      setBusy(null);
    }
  };

  const useHere = () => {
    if (!valid) return setTouched(true);
    printer.save(pickKeys(configFromForm(form), LAYOUT_KEYS));
    toast.success(t("pos.printing.saved"));
  };

  const saveShop = async () => {
    if (!valid) return setTouched(true);
    setBusy("shop");
    try {
      await saveShopPrinting(tenant, resolveConfig({}, { ...printer.config, ...configFromForm(form) }));
      // The shop default now carries the layout; this computer follows it again.
      clearDeviceKeys(tenant, LAYOUT_KEYS);
      printer.reloadShop();
      toast.success(t("pos.printing.savedShop"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const followShop = () => {
    clearDeviceKeys(tenant, LAYOUT_KEYS);
    loaded.current = false;
    printer.reloadShop();
    toast.success(t("pos.printing.reset"));
  };

  const direct = form.transport !== "none";

  return (
    <Page>
      <SettingsNav />
      <PageHeading icon={PrinterIcon} title={t("pos.printing.title")} description={t("pos.printing.subtitle")} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("pos.printing.device.title")}</CardTitle>
            <CardDescription>{t("pos.printing.device.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field>
              <FieldLabel>{t("pos.printing.type")}</FieldLabel>
              <Select value={form.transport} onValueChange={(v) => set("transport", v as TransportKind)}>
                <SelectTrigger aria-label={t("pos.printing.type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((k) => (
                    <SelectItem key={k} value={k} disabled={!supported(k)}>
                      {t(`pos.printing.type.${k}`)}
                      {!supported(k) ? ` · ${t("pos.printing.unsupported")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.transport !== "none" && <FieldHint>{t(`pos.printing.help.${form.transport}`)}</FieldHint>}
            </Field>

            {form.transport === "serial" && (
              <Field invalid={touched && !!errors.baudRate}>
                <FieldLabel>{t("pos.printing.baud")}</FieldLabel>
                <Input value={form.baudRate} onChange={(e) => set("baudRate", e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" />
                {touched && errors.baudRate && <FieldError>1200 – 921600</FieldError>}
              </Field>
            )}

            {form.transport === "bridge" && (
              <>
                <Field invalid={touched && !!errors.bridgeUrl}>
                  <FieldLabel>{t("pos.printing.bridgeUrl")}</FieldLabel>
                  <Input value={form.bridgeUrl} onChange={(e) => set("bridgeUrl", e.target.value)} placeholder="http://127.0.0.1:9101" autoComplete="off" />
                  {touched && errors.bridgeUrl && <FieldError>http://127.0.0.1:9101</FieldError>}
                </Field>
                <Field invalid={touched && !!errors.bridgeToken}>
                  <FieldLabel>{t("pos.printing.bridgeToken")}</FieldLabel>
                  <Input type="password" value={form.bridgeToken} onChange={(e) => set("bridgeToken", e.target.value)} autoComplete="off" />
                  {touched && errors.bridgeToken && <FieldError>≥ 16</FieldError>}
                </Field>
                <Field>
                  <FieldLabel>{t("pos.printing.bridgePrinter")}</FieldLabel>
                  <Input value={form.bridgePrinter} onChange={(e) => set("bridgePrinter", e.target.value)} placeholder="default" autoComplete="off" />
                </Field>
              </>
            )}

            {direct && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {form.transport !== "bridge" && (
                    <Button type="button" variant="outline" onClick={() => void connect()} disabled={busy !== null}>
                      {busy === "connect" ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />} {busy === "connect" ? t("pos.printing.connecting") : t("pos.printing.connect")}
                    </Button>
                  )}
                  <Button type="button" onClick={() => void test()} disabled={busy !== null}>
                    {busy === "test" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />} {t("pos.printing.testPrint")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void drawer()} disabled={busy !== null}>
                    {busy === "drawer" ? <Loader2Icon className="animate-spin" /> : <BanknoteIcon />} {t("pos.printing.testDrawer")}
                  </Button>
                </div>
                {form.transport !== "bridge" &&
                  (connected || printer.config.deviceName ? (
                    <Badge variant="outline" className="w-fit gap-1">
                      <CheckCircle2Icon /> {t("pos.printing.connected", { name: connected ?? printer.config.deviceName })}
                    </Badge>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("pos.printing.notConnected")}</p>
                  ))}
                {testNote && <p className="text-xs text-muted-foreground">{t("pos.printing.testNote")}</p>}
              </>
            )}

            <div>
              <Button type="button" onClick={() => saveDevice(DEVICE_KEYS, t("pos.printing.saved"))}>
                {t("pos.printing.saveDevice")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("pos.printing.receipt.title")}</CardTitle>
            <CardDescription>{t("pos.printing.receipt.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel>{t("pos.printing.paper")}</FieldLabel>
                <Select value={form.paperWidth} onValueChange={(v) => setForm(withPaperWidth(form, v as "58" | "80"))}>
                  <SelectTrigger aria-label={t("pos.printing.paper")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58">{t("pos.printing.paper58")}</SelectItem>
                    <SelectItem value="80">{t("pos.printing.paper80")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field invalid={touched && !!errors.charsPerLine}>
                <FieldLabel>{t("pos.printing.cpl")}</FieldLabel>
                <Input value={form.charsPerLine} onChange={(e) => set("charsPerLine", e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" />
              </Field>
              <Field invalid={touched && !!errors.widthDots}>
                <FieldLabel>{t("pos.printing.dots")}</FieldLabel>
                <Input value={form.widthDots} onChange={(e) => set("widthDots", e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" />
              </Field>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              {t("pos.printing.cplHint")} {t("pos.printing.dotsHint")}
            </p>

            <Field invalid={touched && !!errors.headerText}>
              <FieldLabel>{t("pos.printing.header")}</FieldLabel>
              <Textarea value={form.headerText} onChange={(e) => set("headerText", e.target.value)} rows={3} />
              <FieldHint>{t("pos.printing.headerHint")}</FieldHint>
            </Field>
            <Field invalid={touched && !!errors.footerText}>
              <FieldLabel>{t("pos.printing.footer")}</FieldLabel>
              <Textarea value={form.footerText} onChange={(e) => set("footerText", e.target.value)} rows={3} />
              <FieldHint>{t("pos.printing.footerHint")}</FieldHint>
            </Field>

            <Field>
              <FieldLabel>{t("pos.printing.cut")}</FieldLabel>
              <Select value={form.cut} onValueChange={(v) => set("cut", v as PrintForm["cut"])}>
                <SelectTrigger aria-label={t("pos.printing.cut")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="partial">{t("pos.printing.cut.partial")}</SelectItem>
                  <SelectItem value="full">{t("pos.printing.cut.full")}</SelectItem>
                  <SelectItem value="none">{t("pos.printing.cut.none")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Toggle label={t("pos.printing.logo")} checked={form.showLogo} onChange={(v) => set("showLogo", v)} />
            <Toggle label={t("pos.printing.qr")} checked={form.showQr} onChange={(v) => set("showQr", v)} />

            <h3 className="pt-2 text-sm font-semibold">{t("pos.printing.behaviour.title")}</h3>
            <Toggle label={t("pos.printing.autoPrint")} checked={form.autoPrint} onChange={(v) => set("autoPrint", v)} />
            <Toggle label={t("pos.printing.drawerOnCash")} checked={form.openDrawerOnCash} onChange={(v) => set("openDrawerOnCash", v)} />
            <Field>
              <FieldLabel>{t("pos.printing.drawerPin")}</FieldLabel>
              <Select value={form.drawerPin} onValueChange={(v) => set("drawerPin", v as "0" | "1")}>
                <SelectTrigger aria-label={t("pos.printing.drawerPin")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t("pos.printing.drawerPin0")}</SelectItem>
                  <SelectItem value="1">{t("pos.printing.drawerPin1")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {touched && !valid && (
              <Alert variant="destructive">
                <AlertTitle>{t("pos.printing.fixErrors")}</AlertTitle>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={useHere}>
                {t("pos.printing.useDevice")}
              </Button>
              <Button type="button" onClick={() => void saveShop()} disabled={busy === "shop"}>
                {busy === "shop" && <Loader2Icon className="animate-spin" />} {t("pos.printing.saveShop")}
              </Button>
              <Button type="button" variant="ghost" onClick={followShop}>
                {t("pos.printing.resetDevice")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("pos.printing.shopOnlyAdmin")}</p>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
