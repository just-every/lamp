import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { SubscribersPage } from "../core/features/subscribers/ui/subscribers-page";

export const Route = createFileRoute("/app/subscribers")({ component: withVisualEdits(SubscribersPage) });
