import type { FeatureDef, PermissionDef } from "@rbms/core";

export const KYC_FEATURE = "kyc";
export const KYC_MANAGE = "kyc.manage";

export const KYC_FEATURES: FeatureDef[] = [
  {
    key: KYC_FEATURE,
    module: "kyc",
    label: "KYC verification",
    description:
      "Verify PAN, GSTIN, bank accounts, UPI IDs, DigiLocker (Aadhaar) and selfies for the shop, its sellers and users, with a manual review queue. Aadhaar and bank account numbers are never stored in full.",
  },
];

export const KYC_PERMISSIONS: PermissionDef[] = [
  {
    key: KYC_MANAGE,
    module: "kyc",
    label: "Manage KYC",
    description: "Run verification checks and upload documents for the shop, its sellers and users, and see their KYC status.",
  },
];
