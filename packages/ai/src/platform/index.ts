/** Phase 7 part B: platform tools of the RBMS team (churn signals, support desk with AI triage, What's new notes). */
export * from "./registry";
export * from "./churn";
export * from "./tickets";
export * from "./triage";
export * from "./release-notes";
export * from "./store";
export * from "./service";
export * from "./routes";
export { MemoryPlatformStore } from "./memory-store";

/** Job that triages one new ticket (payload `{ ticketId }`). */
export const TRIAGE_JOB = "platform.ticket-triage";
