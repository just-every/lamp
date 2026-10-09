import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { OverviewPage } from "../core/features/overview/ui/overview-page";

export const Route = createFileRoute("/app/")({ component: withVisualEdits(OverviewPage) });
