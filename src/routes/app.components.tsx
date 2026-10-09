import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { ComponentsPage } from "../core/features/components/ui/components-page";

export const Route = createFileRoute("/app/components")({ component: withVisualEdits(ComponentsPage) });
