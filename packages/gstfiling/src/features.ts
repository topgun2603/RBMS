import type { PermissionDef } from "@rbms/core";

/**
 * GST filing follows the shop's existing "GST reports" feature (`invoices.gst-reports`, the same gate as the GSTR-1
 * download) and its permission `reports.view` for reading. Changing anything (ITC decisions, reverse charge, 2B import,
 * settings) needs `gst.manage`; owners and admins hold every permission.
 */
export const GST_FILING_FEATURE = "invoices.gst-reports";
export const GST_VIEW_PERMISSION = "reports.view";
export const GST_MANAGE_PERMISSION = "gst.manage";

export const GST_FILING_PERMISSIONS: PermissionDef[] = [
  {
    key: GST_MANAGE_PERMISSION,
    module: "gstfiling",
    label: "Manage GST filing",
    description: "Decide input tax credit, reverse charge and composition settings, import GSTR-2B files, mark returns as filed and download the GST files.",
  },
];
