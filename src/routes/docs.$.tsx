import { createFileRoute, notFound } from '@tanstack/react-router';
import { DocsArticle } from '../site/docs/DocsArticle';
import { loadDocsBody } from '../site/docs/body';
import { docsHead, hasDocsPage } from '../site/docs/pages';

// Nested documentation slugs use the same manifest and compiled Markdown as
// single-segment pages. An unlisted path remains a real 404.
export const Route = createFileRoute('/docs/$')({
  beforeLoad: ({ params }) => { if (!params._splat || !hasDocsPage(params._splat)) throw notFound(); },
  loader: ({ params }) => loadDocsBody({ data: params._splat! }),
  head: ({ params }) => docsHead(params._splat),
  component: () => <DocsArticle slug={Route.useParams()._splat!} body={Route.useLoaderData()} />,
});
