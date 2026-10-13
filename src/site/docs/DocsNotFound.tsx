import { DocsLayout } from './DocsLayout';
import { DocsSidebar } from './DocsNav';

/** A /docs address that is not a published page. The route answers it with status 404. */
export function DocsNotFound() {
  return (
    <DocsLayout>
      <DocsSidebar />
      <div id="docs-content" className="docs-content" tabIndex={-1}>
        <header className="docs-head">
          <p className="docs-eyebrow">Docs</p>
          <h1 className="docs-title">That page is not in the docs</h1>
          <p className="docs-lead">The address may be old or mistyped. <a href="/docs">All docs</a> lists every page.</p>
        </header>
      </div>
    </DocsLayout>
  );
}
