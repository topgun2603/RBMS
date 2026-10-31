import type { TenantRef } from "@rbms/core";

/** A tenant membership as the tenancy module stores it. */
export interface MembershipRecord {
  userId: string;
  roles: string[];
  status: "active" | "inactive";
  createdAt: Date;
}

/**
 * Tenant memberships. `tenancy.service` satisfies it as-is (it validates roles: one base level + `role:<key>`).
 */
export interface MembershipPort {
  addMember(tenantId: string, userId: string, roles: string[]): Promise<MembershipRecord>;
  updateRoles(tenantId: string, userId: string, roles: string[]): Promise<MembershipRecord>;
  removeMember(tenantId: string, userId: string): Promise<void>;
  listMembers(tenantId: string): Promise<MembershipRecord[]>;
  rolesFor(tenantId: string, userId: string): Promise<string[]>;
  getMember(tenantId: string, userId: string): Promise<MembershipRecord | null>;
  /** Needed for `PATCH /members/:userId { active }`. */
  setMemberStatus?(tenantId: string, userId: string, status: "active" | "inactive"): Promise<MembershipRecord>;
}

/** User details and invites by phone/email. Wire to auth (`getUsers`, `findOrCreateByTarget`). */
export interface UserDirectoryPort {
  getUsers(
    ids: string[],
  ): Promise<{ id: string; name: string | null; phone: string | null; email: string | null; lastLoginAt: Date | null }[]>;
  /** Finds or creates the user for a phone number or email; throws 400 when the target is invalid. */
  findOrCreateByTarget(target: string): Promise<{ id: string }>;
}

/**
 * Plan usage limits (wire to plans.service). Key "staff" is one seat per active non-owner member; plans checks it
 * against the real membership count (tenancy `seatCounts`), so consume/release here are reservations around the add.
 */
export interface QuotaPort {
  consume(tenant: TenantRef, key: string, amount?: number): Promise<unknown>;
  release(tenant: TenantRef, key: string, amount?: number): Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}
