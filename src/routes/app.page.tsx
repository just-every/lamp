import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { YourPage } from "../core/features/overview/ui/your-page";

export const Route = createFileRoute("/app/page")({ component: withVisualEdits(YourPage) });
