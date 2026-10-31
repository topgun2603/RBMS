/** Feature keys the pharmacy UI uses (declared by @rbms/medicines). */
export const PHARMACY_FEATURES = {
  medicines: "medicines",
  prescriptions: "medicines.prescriptions",
  register: "medicines.register",
} as const;

/** Permissions of @rbms/medicines. Owners and admins hold both. */
export const PHARMACY_PERMISSIONS = {
  manage: "medicines.manage",
  dispense: "medicines.dispense",
} as const;

/** Either permission can read batches and medicine details. */
export const PHARMACY_VIEW = [PHARMACY_PERMISSIONS.manage, PHARMACY_PERMISSIONS.dispense];
