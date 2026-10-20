/** Host settings the pages read (set once by jobcardsModule()). */
export interface JobcardsConfig {
  /** App path of a bill, where payment is taken. */
  invoiceHref: (id: string) => string;
  /** The customer's tracking link for a token; null = no tracking links in this app. */
  trackUrl: (token: string) => string | null;
}

let config: JobcardsConfig = { invoiceHref: (id) => `/invoices/${id}`, trackUrl: () => null };

export function setJobcardsConfig(c: Partial<JobcardsConfig>) {
  config = { ...config, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) };
}

export const jobcardsConfig = () => config;
