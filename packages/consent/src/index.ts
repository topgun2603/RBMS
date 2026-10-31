import { defineModule, type AuditPort, type PermissionDef } from "@rbms/core";
import { consentRoutes } from "./routes";
import { BreachService } from "./privacy-breach";
import { NoticeService } from "./privacy-notice-service";
import type { PrivacyHostPort } from "./privacy-ports";
import { PRIVACY_SETTINGS_DEFAULTS } from "./privacy-settings";
import { RetentionService } from "./privacy-retention";
import { RightsService } from "./privacy-rights";
import { PRIVACY_MANAGE, privacyRoutes } from "./privacy-routes";
import * as schema from "./schema";
import { ConsentService, type ConsentDeps } from "./service";

export const CONSENT_PERMISSIONS: PermissionDef[] = [
  {
    key: PRIVACY_MANAGE,
    module: "consent",
    label: "Manage customer privacy",
    description: "Handle customers' data requests (access, correction, erasure), set retention periods and keep the data breach register.",
  },
];

const EMPTY_HOST: PrivacyHostPort = {
  settings: async () => PRIVACY_SETTINGS_DEFAULTS,
  facts: async () => ({
    shopName: "",
    legalName: "",
    address: "",
    modules: { storefront: false, loyalty: false, memberships: false, pharmacy: false, payroll: false, ai: false, messaging: false, delivery: false, services: false },
  }),
  tenantIds: async () => [],
};

export interface ConsentKitDeps extends ConsentDeps {
  /** Settings, shop facts and the list of shops (apps/api). */
  privacy?: PrivacyHostPort;
  audit?: AuditPort;
}

/**
 * Consent records, data export and account deletion (DPDP Act 2023, Google Play account deletion), plus the shop-level
 * DPDP tools: versioned privacy notices, customers' rights requests, retention rules and the breach register.
 * apps/api registers each module's exporter/eraser; register auth FIRST so its eraser runs LAST.
 */
export function createConsent(deps: ConsentKitDeps) {
  const service = new ConsentService(deps);
  const host = deps.privacy ?? EMPTY_HOST;
  const retention = new RetentionService({ db: deps.db, host, audit: deps.audit, log: deps.log });
  const notices = new NoticeService({ db: deps.db, host, retention });
  const rights = new RightsService({
    db: deps.db,
    host,
    notices,
    audit: deps.audit,
    log: deps.log,
    consentLog: {
      record: (i) =>
        service.record({ userId: i.userId, tenantId: i.tenantId, purposes: i.purposes, version: i.version, source: i.source, ip: i.ip, userAgent: i.userAgent }),
    },
  });
  const breaches = new BreachService({ db: deps.db, audit: deps.audit });
  const privacy = { notices, rights, retention, breaches };
  const accountRoutes = consentRoutes(service);
  const shopRoutes = privacyRoutes(privacy);
  const module = defineModule({
    id: "consent",
    tables: { ...schema },
    permissions: CONSENT_PERMISSIONS,
    routes: async (app) => {
      await accountRoutes(app);
      await shopRoutes(app);
    },
  });
  return { service, privacy, module };
}

export { ConsentService, PROCESS_JOB, SWEEP_JOB } from "./service";
export type { ConsentConfig, ConsentDeps, DataRequestView } from "./service";
export { latestByPurpose, runErasers, runExporters } from "./logic";
export type { ConsentDecision, ExportPayload } from "./logic";
export type { DataEraser, DataExporter, LoggerPort, QueuePort } from "./ports";
export * from "./schema";
export * from "./list";
export * from "./privacy-settings";
export * from "./privacy-notice";
export * from "./privacy-ports";
export * from "./privacy-retention";
export * from "./privacy-rights";
export * from "./privacy-breach";
export { PRIVACY_MANAGE } from "./privacy-routes";
export { NoticeService } from "./privacy-notice-service";
