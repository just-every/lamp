import { CompiledVisualEdits } from '../editor/EditorLauncher';
import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import "../core/app/client/styles.css";
// Lamp's own faces, linked once from the root document head so every document (landing, sign-in,
// first-run setup and the operator app) reads the same declarations before first paint.
import fontsCss from "../site/lamp/fonts.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "description", content: "Lamp status communication." },
      { title: "Lamp" },
    ],
    links: [{ rel: "stylesheet", href: fontsCss }],
  }),
  notFoundComponent: NotFound,
  component: Root,
});

function Root() {
  return <Document><Outlet /></Document>;
}

function NotFound() {
  return <main className="bootstrap-state"><h1>Document not found</h1><p>This operator application has no document at this path.</p></main>;
}

function Document({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><head><HeadContent /></head><body><CompiledVisualEdits />{children}<Scripts /></body></html>;
}
