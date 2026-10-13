import { Outlet, createFileRoute } from '@tanstack/react-router';
import { DocsNotFound } from '../site/docs/DocsNotFound';

// The docs layout route: every /docs address that is not a published page, however deep, answers 404 with the docs' own page.
export const Route = createFileRoute('/docs')({ component: Outlet, notFoundComponent: DocsNotFound });
