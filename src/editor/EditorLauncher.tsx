import { useEffect, useLayoutEffect } from 'react';
import { useRouter } from '@tanstack/react-router';
import { installCompiledLiveEdits, setLiveEditsReady } from './live-edit-runtime';
import visualEdits from './visual-edits.json';
import { mountEditor, type EditorConfig } from './editor-widget';
// Optional server configuration. An authenticated local request reveals no credentials.
export function EditorLauncher({ authorized, initialConfig }: { authorized: boolean; initialConfig?: EditorConfig }) {
  useEffect(() => {
    if (!authorized) return;
    if (initialConfig) return mountEditor(initialConfig, true);
    const controller = new AbortController();
    let cleanup = () => {};
    void fetch('/api/app/editor-config', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Editor unavailable'); return response.json() as Promise<EditorConfig>; })
      .then(config => { if (!controller.signal.aborted) cleanup = mountEditor(config, true); })
      .catch(() => { /* Optional management availability does not block the edition. */ });
    return () => { controller.abort(); cleanup(); };
  }, [authorized, initialConfig]);
  return null;
}

// The document installs source data; the rendered leaf route enables DOM mutation.
export function CompiledVisualEdits() {
  const router = useRouter();
  useLayoutEffect(() => {
    setLiveEditsReady(false);
    const pending = router.subscribe('onBeforeNavigate', () => setLiveEditsReady(false));
    installCompiledLiveEdits(visualEdits);
    return () => { pending(); setLiveEditsReady(false); };
  }, [router]);
  return null;
}
