import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import { buildDocs } from "../../src/site/docs/build/site.ts";

// The docs site is cut from the repository's own Markdown at build time. These tests drive the same function the Vite plugin
// calls, on the real repository and on small repositories written for each rule, so a docs edit that would publish a broken
// link, an image, a section nobody decided about or a build machine's path fails here and in `vite build` alike.
const GITHUB = "https://github.com/just-every/run-lamp";
const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** A repository on disk: package.json, docs/site.json and the files given, which are paths mapped to Markdown. */
function repository({ pages, githubOnly = [], files }) {
  const root = mkdtempSync(join(tmpdir(), "lamp-docs-"));
  roots.push(root);
  const write = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  write("package.json", JSON.stringify({ repository: { type: "git", url: `${GITHUB}.git` } }));
  write("docs/site.json", JSON.stringify({ sections: [{ title: "Guides", pages }], githubOnly }));
  for (const [path, content] of Object.entries(files)) write(path, content);
  return root;
}
const page = (slug, source, extra = {}) => ({ slug, title: slug, summary: `About ${slug}.`, source, ...extra });
const hrefs = (html) => [...html.matchAll(/<a href="([^"]*)"/g)].map(([, href]) => href);

test("the repository's own docs build whole: every page has content and every link and anchor resolves", () => {
  const site = buildDocs(process.cwd());
  const pages = site.sections.flatMap((section) => section.pages);
  assert.ok(pages.length > 3, "the docs publish several pages");
  for (const { slug } of pages) {
    assert.ok(site.bodies[slug].html.length > 100, `${slug} has a body`);
    assert.ok(!/<h1[ >]/.test(site.bodies[slug].html), `${slug} leaves its one h1 to the page head`);
  }
  assert.ok(Object.values(site.bodies).some((body) => hrefs(body.html).some((href) => href.startsWith("/docs/"))), "pages link to each other");
  assert.ok(Object.values(site.bodies).some((body) => hrefs(body.html).some((href) => href.startsWith(`${site.repository.url}/blob/`))), "files that are not published link to GitHub");
});

test("a link to a published file or section goes to its page, any other repository file to GitHub, and the headings keep GitHub's ids", () => {
  const root = repository({
    pages: [page("start", "README.md", { sections: ["Install"] }), page("run", "README.md", { sections: ["Run"] }), page("guide", "docs/guide.md")],
    githubOnly: [{ source: "README.md", section: "Internals", reason: "maintainers" }],
    files: {
      "README.md": "# Shop\n\nIntro [guide](docs/guide.md), [license](LICENSE), [source](src/), [hidden](#internals), [run](#run), [same](#install) and [other](docs/guide.md#more-info).\n\n## Install\n\nText.\n\n## Run\n\nText [back](#install).\n\n## Internals\n\nText.\n",
      "docs/guide.md": "# Guide\n\nBack to the [readme](../README.md) or its [run section](../README.md#run).\n\n## More info\n\nOne.\n\n## More info\n\nTwo.\n",
      LICENSE: "MIT",
      "src/index.js": "",
    },
  });
  const site = buildDocs(root);
  assert.deepEqual(hrefs(site.bodies.start.html), ["/docs/guide", `${GITHUB}/blob/main/LICENSE`, `${GITHUB}/tree/main/src`, `${GITHUB}/blob/main/README.md#internals`, "/docs/run#run", "#install", "/docs/guide#more-info"]);
  assert.deepEqual(hrefs(site.bodies.run.html), ["/docs/start#install"]);
  assert.deepEqual(hrefs(site.bodies.guide.html), ["/docs/start", "/docs/run#run"]);
  assert.ok(site.bodies.guide.html.includes('id="more-info-1"'), "a repeated heading gets GitHub's -1");
  assert.ok(!site.bodies.start.html.includes("Internals"), "a section named in githubOnly is not published");
});

test("a section nobody placed, a missing file or anchor, an image and a build machine's path each fail the build, all listed together", () => {
  const root = repository({
    pages: [page("start", "README.md", { sections: ["Install"] })],
    files: { "README.md": "", "docs/a.md": "# A\n\n## Real\n" },
  });
  // The guard names the machine's own directory, so the page has to say it.
  writeFileSync(join(root, "README.md"), `# Shop\n\n[gone](nope.md) [anchor](#nowhere) [other](docs/a.md#nowhere) ![shot](shot.png)\n\n## Install\n\nBuilt at ${root}/x.\n\n## Orphan\n\nNobody decided.\n`);
  assert.throws(() => buildDocs(root), (error) => {
    for (const expected of ["neither on a page nor in githubOnly", "nope.md (", "no heading #nowhere in README.md", "no heading #nowhere in docs/a.md", "has an image", "a build machine path"]) {
      assert.ok(error.message.includes(expected), `${expected}\n${error.message}`);
    }
    return true;
  });
});

test("raw HTML in Markdown is shown as text and never passed through; a file published whole cannot also hide sections", () => {
  const root = repository({
    pages: [page("only", "README.md")],
    files: { "README.md": "# Shop\n\n<img src=x onerror=alert(1)>\n\n<div>raw</div>\n\n## Part\n\nText.\n" },
  });
  const html = buildDocs(root).bodies.only.html;
  assert.ok(!/<img|<div>raw/.test(html), "no raw tag reaches the page");
  assert.ok(html.includes("&lt;img"), "it is shown as text");
  const hidden = repository({
    pages: [page("only", "README.md")],
    githubOnly: [{ source: "README.md", section: "Part", reason: "x" }],
    files: { "README.md": "# Shop\n\n## Part\n\nText.\n" },
  });
  assert.throws(() => buildDocs(hidden), /published whole, so githubOnly cannot name its sections/);
});
