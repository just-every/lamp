import { createFileRoute, redirect } from "@tanstack/react-router";

// Deliveries is the Subscribers delivery log now (L19). Old links land there for one release.
export const Route = createFileRoute("/app/deliveries")({
  beforeLoad: () => { throw redirect({ to: "/app/subscribers", search: { view: "log" } }); },
});
