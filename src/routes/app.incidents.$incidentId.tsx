import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { IncidentDetailPage } from "../core/features/incidents/ui/incident-detail-page";

export const Route = createFileRoute("/app/incidents/$incidentId")({ component: withVisualEdits(IncidentDetail) });

function IncidentDetail() {
  const { incidentId } = Route.useParams();
  return <IncidentDetailPage incidentId={incidentId} />;
}
