import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { IncidentsPage } from "../core/features/incidents/ui/incidents-page";

export const Route = createFileRoute("/app/incidents/")({ component: withVisualEdits(IncidentsPage) });
