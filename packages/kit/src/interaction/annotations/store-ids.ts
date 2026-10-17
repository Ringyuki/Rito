let fallbackStoreSequence = 0;

/** A prefix no other store's record ids share. */
export function createIdPrefix(): string {
  const runtime = globalThis as unknown as {
    readonly crypto?: { readonly randomUUID?: () => string };
  };
  const uuid = runtime.crypto?.randomUUID?.();
  if (uuid !== undefined && uuid.length > 0) return `annotation-${uuid}`;
  fallbackStoreSequence += 1;
  return `annotation-${Date.now().toString(36)}-${fallbackStoreSequence.toString(36)}`;
}
