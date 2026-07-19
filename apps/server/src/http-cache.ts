function weakEntityTag(value: string): string {
  const tag = value.trim();
  return tag.startsWith("W/") ? tag.slice(2).trim() : tag;
}

export function ifNoneMatchMatches(header: string | undefined, current: string): boolean {
  const currentTag = weakEntityTag(current);
  return header?.split(",").some((value) => {
    const candidate = value.trim();
    return candidate === "*" || weakEntityTag(candidate) === currentTag;
  }) ?? false;
}
