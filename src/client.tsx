import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { StartClient } from '@tanstack/react-start/client';
import { createRecoverableErrorHandler } from './base/hydration/report';

// Preserve Start's client entry and report recovery in the nearest hydration
// unit. The root route still owns compiled visual edits and its lifecycle.
startTransition(() => {
  hydrateRoot(document, <StrictMode><StartClient /></StrictMode>, {
    onRecoverableError: createRecoverableErrorHandler(),
  });
});
