import { createFileRoute, notFound } from '@tanstack/react-router';
import { DocsArticle } from '../site/docs/DocsArticle';
import { loadDocsBody } from '../site/docs/body';
import { docsHead, hasDocsPage } from '../site/docs/pages';

// One docs page, drawn from the repository's Markdown at build time. A slug docs/site.json does not list is a real 404.
export const Route = createFileRoute('/docs/$slug')({
  beforeLoad: ({ params }) => { if (!hasDocsPage(params.slug)) throw notFound(); },
  loader: ({ params }) => loadDocsBody({ data: params.slug }),
  head: ({ params }) => docsHead(params.slug),
  component: () => <DocsArticle slug={Route.useParams().slug} body={Route.useLoaderData()} />,
});
