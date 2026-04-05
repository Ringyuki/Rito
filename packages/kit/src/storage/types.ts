export interface PositionStorageAdapter {
  load(): string | null;
  save(serialized: string): void;
  clear(): void;
}
