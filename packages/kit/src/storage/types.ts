/** A load/save callback must not call ReaderController position actions before its Promise settles. */
export interface PositionStorageAdapter {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
  clear(): Promise<void>;
}
