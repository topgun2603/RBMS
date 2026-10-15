import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const EINVOICE_FEATURE = "gst-einvoice";
export const EWAYBILL_FEATURE = "gst-ewaybill";
export const EINVOICE_PERMISSION = "einvoice.manage";

export const EINVOICE_FEATURES: FeatureDef[] = [
  {
    key: EINVOICE_FEATURE,
    module: "einvoice",
    label: "GST e-invoice (IRN)",
    description:
      "Generate and cancel e-invoices (IRN, acknowledgement and signed QR) for B2B bills through the shop's GSP account, and export GSTR-1 JSON.",
  },
  {
    key: EWAYBILL_FEATURE,
    module: "einvoice",
    label: "E-way bills",
    description: "Generate and cancel e-way bills from an e-invoice (IRN) or directly from a bill, with transporter and vehicle details.",
    dependsOn: [EINVOICE_FEATURE],
  },
];

export const EINVOICE_PERMISSIONS: PermissionDef[] = [
  {
    key: EINVOICE_PERMISSION,
    module: "einvoice",
    label: "Manage e-invoices and e-way bills",
    description: "Set up the e-invoice account, generate / cancel IRNs and e-way bills, and download GSTR-1 JSON.",
  },
];
