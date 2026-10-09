import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { AlertsPage } from "../core/features/intake/ui/alerts-page";

export const Route = createFileRoute("/app/alerts")({ component: withVisualEdits(AlertsPage) });
