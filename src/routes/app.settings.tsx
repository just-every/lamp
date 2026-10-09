import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "../core/features/page-settings/ui/settings-page";

export const Route = createFileRoute("/app/settings")({ component: withVisualEdits(SettingsPage) });
