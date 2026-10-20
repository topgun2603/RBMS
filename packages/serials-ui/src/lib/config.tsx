"use client";

import * as React from "react";

export interface SerialsConfig {
  /** App-absolute link to a bill. */
  invoiceHref: (id: string) => string;
}

const defaultConfig: SerialsConfig = { invoiceHref: (id) => `/invoices/${id}` };
const SerialsConfigContext = React.createContext<SerialsConfig>(defaultConfig);

export const useSerialsConfig = () => React.useContext(SerialsConfigContext);

/** Wraps a route / widget component so it reads this mount's options. */
export function withConfig(Component: React.ComponentType, config: SerialsConfig): React.ComponentType {
  function WithSerialsConfig() {
    return (
      <SerialsConfigContext.Provider value={config}>
        <Component />
      </SerialsConfigContext.Provider>
    );
  }
  return WithSerialsConfig;
}
