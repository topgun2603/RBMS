/** Host settings the pages read (set once by jewelleryModule()). */
export interface JewelleryConfig {
  /** App path of a bill. */
  invoiceHref: (id: string) => string;
}

let config: JewelleryConfig = { invoiceHref: (id) => `/invoices/${id}` };

export function setJewelleryConfig(c: Partial<JewelleryConfig>) {
  config = { ...config, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) };
}

export const jewelleryConfig = () => config;
