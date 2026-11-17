export function createId(prefix = "id"): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function stableImportId(sourceId: string, entityId: string): string {
  const safe = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._:/-]/g, "-");
  return `import:${safe(sourceId)}:${safe(entityId)}`;
}

