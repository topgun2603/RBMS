import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BREACH_CHECKLIST, BREACH_DATA_TYPES, RIGHTS_STATUSES, RIGHTS_TYPES } from "./queries-privacy";
import { privacyEn, privacyTa } from "./messages-privacy";
import { workspaceMessages } from "./messages";

const SOURCES = ["../pages/privacy.tsx", "../components/privacy/requests.tsx", "../components/privacy/breaches.tsx"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");

describe("privacy strings", () => {
  it("English and Tamil have the same keys, all in the workspace bundle", () => {
    expect(Object.keys(privacyTa).sort()).toEqual(Object.keys(privacyEn).sort());
    for (const k of Object.keys(privacyEn)) {
      expect(workspaceMessages.en[k as keyof typeof workspaceMessages.en], k).toBe(privacyEn[k]);
      expect(workspaceMessages.ta[k as keyof typeof workspaceMessages.ta], k).toBe(privacyTa[k]);
    }
  });

  it("every literal key the screens use exists", () => {
    const used = [...SOURCES.matchAll(/t\("(workspace\.privacy\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(40);
    for (const k of used) expect(privacyEn[k], k).toBeTruthy();
  });

  it("every dynamic key family is covered", () => {
    for (const k of RIGHTS_TYPES) expect(privacyEn[`workspace.privacy.req.type.${k}`], k).toBeTruthy();
    for (const k of RIGHTS_STATUSES) expect(privacyEn[`workspace.privacy.req.status.${k}`], k).toBeTruthy();
    for (const k of BREACH_DATA_TYPES) expect(privacyEn[`workspace.privacy.br.type.${k}`], k).toBeTruthy();
    for (const k of BREACH_CHECKLIST) expect(privacyEn[`workspace.privacy.br.check.${k}`], k).toBeTruthy();
    for (const k of ["ok", "due_soon", "overdue", "done"]) expect(privacyEn[`workspace.privacy.br.clock.${k}`], k).toBeTruthy();
    for (const k of ["created", "status", "note", "located", "exported", "erased", "consent_withdrawn", "cancelled"]) expect(privacyEn[`workspace.privacy.req.event.${k}`], k).toBeTruthy();
    for (const k of ["abandoned_carts", "inactive_store_customers", "support_transcripts", "chat_messages", "whatsapp_chats", "prescriptions", "lapsed_members", "staff_after_exit", "kyc_documents", "ai_run_inputs", "otp_logs", "login_sessions", "audit_log", "data_exports"]) {
      expect(privacyEn[`workspace.privacy.ret.cat.${k}`], k).toBeTruthy();
      expect(privacyEn[`workspace.privacy.ret.cat.${k}.desc`], k).toBeTruthy();
    }
  });
});
