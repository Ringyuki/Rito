import { useEffect, useState } from 'react';

interface FrameDiagnostics {
  readonly paginationBackend?: 'fragment' | 'retained' | null;
  readonly revisionStatus?: string;
}

/**
 * Cutover diagnostics badge: shows which layout engine painted the frame
 * on screen, so engine evaluation never needs guesswork. Rendered only
 * when the fragment-pagination lever is on.
 */
export function EngineBadge() {
  const [backend, setBackend] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const frame = (globalThis as { __ritoLastFrame?: FrameDiagnostics }).__ritoLastFrame;
      setBackend(frame?.paginationBackend ?? null);
      setStatus(frame?.revisionStatus ?? null);
    };
    read();
    const timer = setInterval(read, 500);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (!backend) return null;
  const fragment = backend === 'fragment';
  const label = fragment
    ? '新引擎 fragment'
    : status === 'complete'
      ? '旧引擎 retained（本书无法切换）'
      : '旧引擎 retained（排版中…）';
  return (
    <div
      data-testid="engine-badge"
      className={`fixed bottom-3 left-3 z-30 rounded-md px-2 py-1 text-xs font-medium shadow ${
        fragment ? 'bg-emerald-600 text-white' : 'bg-zinc-500 text-white'
      }`}
    >
      {label}
    </div>
  );
}
