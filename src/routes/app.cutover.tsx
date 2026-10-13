import { withVisualEdits } from '../editor/VisualEditBoundary';
import { createFileRoute } from '@tanstack/react-router';
import { CutoverPage } from '../core/features/statuspage-import/ui/cutover-page';
export const Route = createFileRoute('/app/cutover')({ component: withVisualEdits(CutoverPage) });
