/**
 * Goods and services on which the buyer, not the supplier, pays GST (reverse charge, Section 9(3) and 9(4) CGST Act and
 * Section 5(3) and 5(4) IGST Act). The list follows the notifications named in `ref` in plain words. It is a helper, not
 * legal advice: rates and conditions change, so the owner can override the rate on every document and picks the
 * categories that apply to the shop (GST settings).
 */
export interface RcmCategory {
  key: string;
  name: string;
  nameTa: string;
  /** Usual GST percent (the buyer can override on the document). */
  rate: number;
  kind: "goods" | "services";
  /** Short note on when it applies. */
  note: string;
  /** Section / notification entry. */
  ref: string;
  /** Applies only when the supplier is unregistered. */
  unregisteredOnly?: boolean;
  /** An import: the tax is always IGST. */
  import?: boolean;
}

export const RCM_CATEGORIES: RcmCategory[] = [
  {
    key: "gta",
    name: "Goods transport agency (lorry / transport freight)",
    nameTa: "சரக்கு போக்குவரத்து முகவர் (லாரி கட்டணம்)",
    rate: 5,
    kind: "services",
    note: "Transport of goods by road by a GTA that did not charge GST under forward charge; the buyer is a registered person, factory, society, firm or company.",
    ref: "Notification 13/2017-CT(R) entry 1",
  },
  {
    key: "legal",
    name: "Legal services (advocate / law firm)",
    nameTa: "சட்ட சேவை (வழக்கறிஞர்)",
    rate: 18,
    kind: "services",
    note: "Service by an individual advocate or firm of advocates to a business.",
    ref: "Notification 13/2017-CT(R) entry 2",
  },
  {
    key: "sponsorship",
    name: "Sponsorship services",
    nameTa: "விளம்பர ஆதரவு சேவை",
    rate: 18,
    kind: "services",
    note: "Sponsorship supplied by anyone other than a body corporate or partnership firm.",
    ref: "Notification 13/2017-CT(R) entry 4",
  },
  {
    key: "government",
    name: "Services from Government or a local authority",
    nameTa: "அரசு / உள்ளாட்சி சேவை",
    rate: 18,
    kind: "services",
    note: "Services by the Central or State Government or a local authority to a business, except a few listed ones.",
    ref: "Notification 13/2017-CT(R) entry 5",
  },
  {
    key: "director",
    name: "Director fee (non-employee director)",
    nameTa: "இயக்குநர் கட்டணம்",
    rate: 18,
    kind: "services",
    note: "Services by a director to the company (not salary as an employee).",
    ref: "Notification 13/2017-CT(R) entry 6",
  },
  {
    key: "insurance_agent",
    name: "Insurance agent commission",
    nameTa: "காப்பீட்டு முகவர் கமிஷன்",
    rate: 18,
    kind: "services",
    note: "Services by an insurance agent to an insurance company.",
    ref: "Notification 13/2017-CT(R) entry 7",
  },
  {
    key: "recovery_agent",
    name: "Recovery agent (bank / finance company)",
    nameTa: "வசூல் முகவர்",
    rate: 18,
    kind: "services",
    note: "Services by a recovery agent to a bank, financial institution or NBFC.",
    ref: "Notification 13/2017-CT(R) entry 8",
  },
  {
    key: "security",
    name: "Security services (non-company supplier)",
    nameTa: "பாதுகாப்பு சேவை",
    rate: 18,
    kind: "services",
    note: "Security services from anyone other than a body corporate, to a registered person.",
    ref: "Notification 29/2018-CT(R)",
  },
  {
    key: "rent_vehicle",
    name: "Renting of a motor vehicle to a company",
    nameTa: "வாகன வாடகை (நிறுவனத்திற்கு)",
    rate: 5,
    kind: "services",
    note: "Renting of a passenger motor vehicle with fuel cost included, by a non-company to a company.",
    ref: "Notification 13/2017-CT(R) entry 15 (as amended)",
  },
  {
    key: "rent_residential",
    name: "Renting of residential property to a registered business",
    nameTa: "குடியிருப்பு கட்டிட வாடகை (பதிவு பெற்ற வணிகத்திற்கு)",
    rate: 18,
    kind: "services",
    note: "Renting of a residential dwelling to a registered person. Check the current conditions with your accountant.",
    ref: "Notification 5/2022-CT(R)",
  },
  {
    key: "author_royalty",
    name: "Royalty to an author or music composer",
    nameTa: "எழுத்தாளர் / இசையமைப்பாளர் உரிமைத்தொகை",
    rate: 12,
    kind: "services",
    note: "Services by an author, composer, photographer or artist to a publisher, music company or producer, where the author did not opt for forward charge.",
    ref: "Notification 13/2017-CT(R) entry 20",
  },
  {
    key: "unregistered_notified_goods",
    name: "Notified goods bought from an unregistered supplier (e.g. cashew nuts, tobacco leaves, raw cotton)",
    nameTa: "பதிவு செய்யாத விற்பனையாளரிடமிருந்து அறிவிக்கப்பட்ட பொருட்கள்",
    rate: 5,
    kind: "goods",
    note: "A short list of goods is taxed in the buyer's hands when bought from an unregistered supplier. Check the list for your goods.",
    ref: "Notification 4/2017-CT(R) as amended",
    unregisteredOnly: true,
  },
  {
    key: "import_services",
    name: "Import of services (supplier outside India)",
    nameTa: "வெளிநாட்டிலிருந்து சேவை இறக்குமதி",
    rate: 18,
    kind: "services",
    note: "Services bought from outside India are taxed as IGST in the buyer's hands; credit is available if used for business.",
    ref: "Section 5(3) IGST Act",
    import: true,
  },
  {
    key: "section_9_4",
    name: "Other supply notified under Section 9(4)",
    nameTa: "பிரிவு 9(4) கீழ் அறிவிக்கப்பட்ட பிற விநியோகம்",
    rate: 18,
    kind: "services",
    note: "Section 9(4) now applies to notified classes only (for example a promoter buying land). Buying from an unregistered supplier is not under reverse charge in general.",
    ref: "Section 9(4) CGST Act",
  },
  {
    key: "other",
    name: "Other (type your own rate)",
    nameTa: "மற்றவை (உங்கள் சொந்த வீதம்)",
    rate: 18,
    kind: "services",
    note: "Anything else your accountant says is under reverse charge.",
    ref: "-",
  },
];

export const rcmCategory = (key: string | null | undefined) => RCM_CATEGORIES.find((c) => c.key === key) ?? null;
