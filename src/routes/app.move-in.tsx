import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { MoveInPage } from "../core/features/statuspage-import/ui/move-in-page";

export const Route = createFileRoute("/app/move-in")({ component: withVisualEdits(MoveInPage) });
