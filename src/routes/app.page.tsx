import { createFileRoute, redirect } from "@tanstack/react-router";

// Your page is the top of Settings › Page now (L19). Old links land there for one release.
export const Route = createFileRoute("/app/page")({
  beforeLoad: () => { throw redirect({ to: "/app/settings", hash: "page" }); },
});
