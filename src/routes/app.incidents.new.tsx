import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { NewIncidentPage } from "../core/features/incidents/ui/new-incident-page";

export const Route = createFileRoute("/app/incidents/new")({ component: withVisualEdits(NewIncident) });

function NewIncident() {
  return <NewIncidentPage />;
}
