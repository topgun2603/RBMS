/** Custom-domain verification helpers (pure): tokens, DNS instructions, the verifier port and the feature. */
import { randomToken, type FeatureDef } from "@rbms/core";

/** TXT record name prefix: `_srikit-verify.<domain>`. */
export const VERIFY_RECORD_PREFIX = "_srikit-verify";
/** Default CNAME target (env CNAME_TARGET in apps/api). */
export const DEFAULT_CNAME_TARGET = "stores.srikit.in";
export const CUSTOM_DOMAIN_FEATURE = "custom-domain";

export const TENANCY_FEATURES: FeatureDef[] = [
  {
    key: CUSTOM_DOMAIN_FEATURE,
    module: "tenancy",
    label: "Custom domain",
    description: "Serve the shop on its own domain (e.g. shop.example.in) after a DNS check.",
  },
];

/** Result of a DNS check. `txt` decides verification; `cname` is reported for guidance. */
export interface DomainCheck {
  txt: boolean;
  cname: boolean;
}

/**
 * DNS check for a custom domain (apps/api implements it with node:dns/promises): `txt` = a TXT record at
 * `_srikit-verify.<domain>` equals `token`; `cname` = the domain CNAMEs to the platform target.
 */
export type DomainVerifier = (domain: string, opts: { token: string }) => Promise<DomainCheck>;

/** New verification token, e.g. "srikit-verify-3q2x…" (URL-safe, fits a TXT record). */
export const newVerificationToken = () => `srikit-verify-${randomToken(18)}`;

/** Second-level suffixes under which the registrable domain has three labels (common in India and nearby). */
const TWO_PART_SUFFIXES = new Set([
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "gov.in", "res.in", "nic.in",
  "co.uk", "org.uk", "com.au", "net.au", "com.sg", "com.my", "com.lk", "com.np", "com.bd", "co.nz", "co.za", "com.br",
]);

/** True when `domain` looks like a registrable root (no subdomain), where a plain CNAME isn't allowed. */
export function isApexDomain(domain: string): boolean {
  const labels = domain.toLowerCase().split(".");
  if (labels.length <= 2) return true;
  return labels.length === 3 && TWO_PART_SUFFIXES.has(labels.slice(1).join("."));
}

export interface DnsRecord {
  type: "TXT" | "CNAME";
  host: string;
  value: string;
  note?: string;
}

export interface DomainInstructions {
  domain: string;
  records: DnsRecord[];
  status: "verified" | "pending";
}

/** The DNS records the shop owner adds at their domain provider. */
export function domainInstructions(
  d: { domain: string; verificationToken: string; verified: boolean },
  cnameTarget: string = DEFAULT_CNAME_TARGET,
): DomainInstructions {
  const cname: DnsRecord = { type: "CNAME", host: d.domain, value: cnameTarget };
  if (isApexDomain(d.domain)) {
    cname.note =
      `A root domain can't have a plain CNAME: use your provider's ALIAS/ANAME (CNAME flattening) record, ` +
      `or add www.${d.domain} as the shop's domain instead.`;
  }
  return {
    domain: d.domain,
    records: [{ type: "TXT", host: `${VERIFY_RECORD_PREFIX}.${d.domain}`, value: d.verificationToken }, cname],
    status: d.verified ? "verified" : "pending",
  };
}

/**
 * Whether `POST /domains/:id/verify` skips the DNS check. Only super-admins force, and only when they ask for it
 * (`{ force: true }`) or when no DNS verifier is wired (then forcing is the only way). Everyone else gets the check.
 */
export function shouldForceVerify(o: { superAdmin: boolean; requested: boolean | undefined; canSelfVerify: boolean }): boolean {
  return o.superAdmin && (o.requested === true || !o.canSelfVerify);
}
