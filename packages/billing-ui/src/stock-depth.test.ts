import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { billingMessages } from "./lib/messages";

const FILES = [
  "pages/batches.tsx",
  "pages/stock-audits.tsx",
  "pages/stock-audit-detail.tsx",
  "pages/transfers.tsx",
  "pages/transfer-new.tsx",
  "pages/transfer-detail.tsx",
  "components/inventory/batch-bits.tsx",
  "components/inventory/batch-receive-dialog.tsx",
  "components/inventory/batch-dialogs.tsx",
  "components/inventory/audit-bits.tsx",
  "components/inventory/scan-dialog.tsx",
  "components/inventory/line-batch-select.tsx",
  "components/inventory/grn-batch-fields.tsx",
  "components/inventory/item-batch-toggle.tsx",
  "widgets/expiry.tsx",
];

describe("stock depth messages", () => {
  const { en, ta } = billingMessages;

  it("English and Tamil have the same keys", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("defines every literal billing.* key the batch, audit and transfer screens use, in both languages", () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(join(__dirname, f), "utf8");
      for (const m of src.matchAll(/["`](billing\.[A-Za-z0-9_.]+)["`]/g)) {
        const key = m[1]!;
        if (!(key in en) || !(key in ta)) missing.push(`${f}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("defines the key families built from a status, reason or state", () => {
    const families: Record<string, string[]> = {
      "billing.audit.status.": ["draft", "counting", "review", "approved", "cancelled"],
      "billing.audit.hint.": ["draft", "counting", "review", "approved", "cancelled"],
      "billing.audit.reason.": ["damaged", "expired", "theft", "entry_error", "found", "supplier_short", "other"],
      "billing.audit.count.filter.": ["uncounted", "counted", "all"],
      "billing.audit.review.filter.": ["variance", "all", "uncounted"],
      "billing.transfers.status.": ["draft", "in_transit", "partially_received", "closed", "cancelled"],
      "billing.transfers.hint.": ["draft", "in_transit", "partially_received", "closed", "cancelled"],
      "billing.transfers.step.": ["created", "sent", "received", "closed"],
      "billing.transfers.confirm.": ["sendTitle", "sendBody", "sendAction", "cancelTitle", "cancelBody", "cancelAction", "deleteTitle", "deleteBody", "deleteAction"],
      "billing.batches.status.": ["expired", "expiring", "ok", "none"],
      "billing.batches.adjust.reason.": ["adjustment", "expired", "damaged"],
      "billing.batches.settings.expired.": ["block", "warn", "allow", "blockHint", "warnHint", "allowHint"],
      "billing.batches.settings.pick.": ["fefo", "manual", "fefoHint", "manualHint"],
      "billing.batches.reason.": [
        "receive", "opening", "sale", "sale_cancel", "sale_return", "sale_return_cancel", "adjustment", "audit", "expired", "damaged",
        "transfer_out", "transfer_in", "purchase_return", "purchase_return_cancel", "purchase_cancel", "assign",
      ],
      "billing.audit.scan.": ["unsupportedTitle", "unsupportedBody", "deniedTitle", "deniedBody", "errorTitle", "errorBody"],
    };
    for (const [prefix, names] of Object.entries(families)) for (const n of names) expect(en[prefix + n], prefix + n).toBeTruthy();
  });

  it("plural messages keep their placeholders in Tamil", () => {
    for (const k of ["billing.batches.daysLeft", "billing.audit.approveBody", "billing.batches.tiles.expiredHint"]) {
      for (const ph of (en[k]!.match(/\{(\w+)[,}]/g) ?? []).map((x) => x.slice(1, -1))) expect(ta[k], `${k} ${ph}`).toContain(`{${ph}`);
    }
  });
});
