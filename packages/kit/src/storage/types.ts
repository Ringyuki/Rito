export interface PositionStorageAdapter {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
  clear(): Promise<void>;
}
