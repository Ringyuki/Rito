import { useCallback, useRef } from 'react';

/**
 * Encapsulates the hidden file input + FileReader logic for loading EPUB files.
 * Returns a ref for the hidden input, an onChange handler, and a trigger function.
 */
export function useFileLoader(onLoad: (data: ArrayBuffer) => void): {
  inputRef: React.RefObject<HTMLInputElement | null>;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  openFilePicker: () => void;
} {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          onLoad(reader.result);
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
    },
    [onLoad],
  );

  const openFilePicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return { inputRef, handleChange, openFilePicker };
}
