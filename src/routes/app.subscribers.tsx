import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { SubscribersPage } from "../core/features/subscribers/ui/subscribers-page";
import { DeliveryLog } from "../core/features/deliveries/ui/deliveries-page";

type SubscribersSearch = { view?: "log" };

// Subscribers has two views: the people and services (the default) and the delivery log (`?view=log`).
export const Route = createFileRoute("/app/subscribers")({
  validateSearch: (search: Record<string, unknown>): SubscribersSearch => search.view === "log" ? { view: "log" } : {},
  component: withVisualEdits(Subscribers),
});

function Subscribers() {
  const { view } = Route.useSearch();
  return view === "log" ? <DeliveryLog /> : <SubscribersPage />;
}
