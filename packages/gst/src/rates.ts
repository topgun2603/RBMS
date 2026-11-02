/**
 * GST rates (combined CGST + SGST, or IGST), percent. The one list every picker, validator and importer uses.
 *
 * In force from 22 September 2025: Notification No. 9/2025-Central Tax (Rate) dated 17.09.2025 (superseding 1/2017),
 * CGST schedules I 2.5%, II 9%, III 20%, IV 1.5%, V 0.125%, VI 0.75%, VII 14%, so combined 5, 18, 40, 3, 0.25, 1.5
 * and 28. Schedule VII (28%: pan masala, cigarettes, tobacco) was omitted from 1 February 2026 by 19/2025-CT(R) dated
 * 31.12.2025, those goods moving to 40%; the same day 03/2025-Compensation Cess (Rate) cut their compensation cess to
 * nil, so no current sale carries cess. 0.1% is the concessional rate for supplies to merchant exporters
 * (40/2017-CT(R)).
 *
 * 12% and 28% stay accepted: bills dated before those changes, credit / debit notes against them, purchase bills from
 * that time and imports of old history. Stored bills keep the rate they were made with; nothing here re-rates them.
 *
 * Not modelled: RSP-based valuation of tobacco and pan masala (CGST rule 31D, from 1 February 2026); the excise duty
 * and the Health Security se National Security Cess on those goods are outside GST and are not on a shop's GST bill.
 */
export const GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28, 40] as const;
export type GstRate = (typeof GST_RATES)[number];

export const isGstRate = (v: unknown): v is GstRate => GST_RATES.includes(v as GstRate);

/**
 * The short list for pickers that offer only the usual slabs for a new item (the full GST_RATES list stays valid
 * everywhere; a picker keeps an item's existing rate selectable when it is not in this list).
 */
export const COMMON_GST_RATES = [0, 5, 18, 40] as const satisfies readonly GstRate[];
