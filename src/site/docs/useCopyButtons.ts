import { useCallback } from 'react';

/**
 * A ref for the rendered article that turns on the Copy button of every code card. The buttons ship hidden in the
 * build-time HTML and only appear where the clipboard can be written, so a page without its script shows no dead button.
 */
export function useCopyButtons() {
  return useCallback((node: HTMLElement | null) => {
    if (!node || !navigator.clipboard?.writeText) return;
    const stops = [...node.querySelectorAll<HTMLButtonElement>('.docs-copy')].map(button => {
      const code = button.closest('.docs-code')?.querySelector('code');
      if (!code) return () => {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      const copy = () => {
        void navigator.clipboard.writeText(code.textContent ?? '').then(() => {
          button.textContent = 'Copied';
          clearTimeout(timer);
          timer = setTimeout(() => { button.textContent = 'Copy'; }, 1600);
        }, () => {});
      };
      button.hidden = false;
      button.addEventListener('click', copy);
      return () => { clearTimeout(timer); button.removeEventListener('click', copy); };
    });
    return () => stops.forEach(stop => stop());
  }, []);
}
