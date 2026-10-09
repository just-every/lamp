import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { DeliveriesPage } from "../core/features/deliveries/ui/deliveries-page";

export const Route = createFileRoute("/app/deliveries")({ component: withVisualEdits(DeliveriesPage) });
