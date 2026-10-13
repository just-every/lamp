import { createServerFn } from '@tanstack/react-start';
import type { DocsBody } from './types';

// A page's rendered body and contents list, read on the server only: the generated module holding every page's text is
// imported inside the handler, so the browser bundle gets the generated RPC stub and none of the docs' text. The route
// loads it on the server for the page's own document; the stub is only used if a client navigation asks again.
export const loadDocsBody = createServerFn({ method: 'GET' })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data }): Promise<DocsBody> => {
    const { bodies } = await import('virtual:lamp-docs/bodies');
    if (!Object.hasOwn(bodies, data)) throw new Error(`The docs have no page "${data}".`);
    return bodies[data];
  });
