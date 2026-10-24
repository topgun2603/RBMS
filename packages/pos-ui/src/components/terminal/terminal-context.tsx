"use client";

import * as React from "react";
import type { DeviceInfo, PinSession } from "../../lib/terminal-types";

/** Terminal mode (a paired device unlocked with a PIN). Null in the normal staff-session counter. */
export interface TerminalEnv {
  device: DeviceInfo;
  session: PinSession;
  /** Lock the terminal (Lock / Switch cashier, idle, Exit). */
  lock: (reason?: "idle" | "expired" | "locked") => void;
  /** Feature check against GET /pos/device's list (the device's own answer). */
  has: (feature: string) => boolean;
}

const TerminalContext = React.createContext<TerminalEnv | null>(null);

export const TerminalProvider = TerminalContext.Provider;

export function useTerminal(): TerminalEnv | null {
  return React.useContext(TerminalContext);
}
