export function getWorkerModuleUrl(): URL {
  return new URL('./worker', import.meta.url);
}
