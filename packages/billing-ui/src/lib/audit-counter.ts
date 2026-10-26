/**
 * The count's default counter name is "user-" plus the start of the member's id (the server has no names). Shows the
 * signed-in member as their name, email or "Owner"; other members as a plain label; typed names are left as typed.
 */
export function counterLabel(counter: string, me: { id?: string; name?: string | null; email?: string | null } | null | undefined, labels: { owner: string; member: string }): string {
  const m = /^user-([0-9a-f]{8})$/i.exec(counter);
  if (!m) return counter;
  if (me?.id && me.id.toLowerCase().startsWith(m[1]!.toLowerCase())) return me.name?.trim() || me.email?.trim() || labels.owner;
  return labels.member;
}
