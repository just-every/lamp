import { createFileRoute } from '@tanstack/react-router';
import { DocsIndex } from '../site/docs/DocsIndex';
import { docsHead } from '../site/docs/pages';

// The docs home. Public, like the landing page: no session, and nothing of the installation in it.
export const Route = createFileRoute('/docs/')({ head: () => docsHead(), component: DocsIndex });
