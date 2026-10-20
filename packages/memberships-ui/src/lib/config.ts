/** Host settings the pages read (set once by membershipsModule()). */
export interface MembershipsConfig {
  /** App path of a bill, where payment is taken. */
  invoiceHref: (id: string) => string;
}

let config: MembershipsConfig = { invoiceHref: (id) => `/invoices/${id}` };

export function setMembershipsConfig(c: Partial<MembershipsConfig>) {
  config = { ...config, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) };
}

export const membershipsConfig = () => config;
