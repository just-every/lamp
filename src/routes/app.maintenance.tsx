import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { MaintenancePage } from "../core/features/maintenance/ui/maintenance-page";

export const Route = createFileRoute("/app/maintenance")({ component: withVisualEdits(MaintenancePage) });
