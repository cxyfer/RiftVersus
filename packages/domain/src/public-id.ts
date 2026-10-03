export interface PublicIdCandidate {
  id: string;
  namespace: string;
  label: string;
  disambiguator?: string;
}

export interface PublicIdAssignment {
  id: string;
  namespace: string;
  publicId: string;
}

export function normalizePublicId(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, "-");
}

export function allocatePublicIds(candidates: readonly PublicIdCandidate[], existing: readonly PublicIdAssignment[] = []): PublicIdAssignment[] {
  const owners = new Map<string, string>();
  const assigned = new Map<string, PublicIdAssignment>();
  const key = (namespace: string, publicId: string) => JSON.stringify([namespace, publicId]);
  for (const item of existing) {
    const owner = owners.get(key(item.namespace, item.publicId));
    if (owner !== undefined && owner !== item.id) throw new Error("Conflicting public ID owners.");
    if (assigned.has(item.id)) throw new Error("Duplicate public ID assignment.");
    owners.set(key(item.namespace, item.publicId), item.id);
    assigned.set(item.id, item);
  }
  const pending = candidates.filter(item => !assigned.has(item.id));
  for (const item of candidates) {
    if (assigned.has(item.id) && assigned.get(item.id)!.namespace !== item.namespace) throw new Error("Public ID namespace is immutable.");
  }
  const counts = new Map<string, number>();
  for (const item of pending) {
    const base = normalizePublicId(item.label);
    if (!base) throw new Error("Public ID label must not be empty.");
    const group = key(item.namespace, base);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const ordered = [...pending].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const item of ordered) {
    if (assigned.has(item.id)) throw new Error("Duplicate public ID candidate.");
    const base = normalizePublicId(item.label);
    const group = key(item.namespace, base);
    let publicId = base;
    if (counts.get(group)! > 1 || owners.has(group) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(base)) {
      const suffix = normalizePublicId(item.disambiguator ?? "");
      publicId = suffix && suffix !== base ? `${base}--${suffix}` : base;
      if (publicId === base || owners.has(key(item.namespace, publicId))) {
        const identity = item.id.replaceAll("-", "");
        let length = 8;
        do {
          publicId = `${base}--${identity.slice(0, length)}`;
          length += 4;
          if (length > identity.length + 4 && owners.has(key(item.namespace, publicId))) throw new Error("Cannot allocate unique public ID.");
        } while (owners.has(key(item.namespace, publicId)));
      }
    }
    const result = { id: item.id, namespace: item.namespace, publicId };
    owners.set(key(item.namespace, publicId), item.id);
    assigned.set(item.id, result);
  }
  return candidates.map(item => assigned.get(item.id)!);
}
