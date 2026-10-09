import { useEffect, type ComponentType } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { setLiveEditsReady } from './live-edit-runtime';
/** No extra DOM: the leaf effect runs after its page has hydrated. */
export function withVisualEdits(Page: ComponentType) {
  return function VisualEditPage() {
    const href = useRouterState({ select: state => state.location.href });
    useEffect(() => { setLiveEditsReady(true); }, [href]);
    return <Page />;
  };
}
