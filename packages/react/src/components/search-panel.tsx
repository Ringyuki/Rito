import { useCallback, useEffect, useRef } from 'react';
import type { ReaderController } from '@rito/kit';
import { useSearch } from '../hooks/use-search';

export interface SearchPanelProps {
  readonly controller: ReaderController | null;
  readonly onClose?: (() => void) | undefined;
  readonly className?: string | undefined;
  readonly inputClassName?: string | undefined;
  readonly buttonClassName?: string | undefined;
}

export function SearchPanel({
  controller,
  onClose,
  className,
  inputClassName,
  buttonClassName,
}: SearchPanelProps): React.JSX.Element {
  const { query, setQuery, results, activeIndex, next, prev, clear } = useSearch(controller);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        prev();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        next();
      }
    },
    [onClose, prev, next],
  );

  const handleClose = useCallback(() => {
    clear();
    onClose?.();
  }, [clear, onClose]);

  const count = results.length;
  const display = count > 0 ? `${String(activeIndex + 1)}/${String(count)}` : '0/0';

  return (
    <div className={className} style={defaultPanelStyle}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className={inputClassName}
        style={inputClassName ? undefined : defaultInputStyle}
      />
      <button type="button" onClick={prev} disabled={count === 0} className={buttonClassName}>
        &#9650;
      </button>
      <button type="button" onClick={next} disabled={count === 0} className={buttonClassName}>
        &#9660;
      </button>
      <span style={{ fontSize: '0.875rem', minWidth: '3em', textAlign: 'center' }}>{display}</span>
      <button type="button" onClick={handleClose} className={buttonClassName}>
        &#10005;
      </button>
    </div>
  );
}

const defaultPanelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.5rem 1rem',
};

const defaultInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.25rem 0.5rem',
  fontSize: '0.875rem',
  border: '1px solid #ccc',
  borderRadius: '0.25rem',
  outline: 'none',
};
