/** A typed event emitter. T maps event names to payload types. */
export interface TypedEmitter<T> {
  on<K extends keyof T & string>(event: K, handler: (data: T[K]) => void): () => void;
  off<K extends keyof T & string>(event: K, handler: (data: T[K]) => void): void;
  emit<K extends keyof T & string>(event: K, data: T[K]): void;
}

export function createEmitter<T>(): TypedEmitter<T> {
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  return {
    on<K extends keyof T & string>(event: K, handler: (data: T[K]) => void): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      const h = handler as (data: unknown) => void;
      set.add(h);
      return () => {
        set.delete(h);
      };
    },

    off<K extends keyof T & string>(event: K, handler: (data: T[K]) => void): void {
      listeners.get(event)?.delete(handler as (data: unknown) => void);
    },

    emit<K extends keyof T & string>(event: K, data: T[K]): void {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of set) handler(data);
    },
  };
}
