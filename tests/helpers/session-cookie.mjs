import { localCookieName } from '@runeditrun/rer/internal/modules/operator-auth/http.mjs';

// Base names the local operator session cookie per configured port, so two
// checkouts on one machine never share a sign-in.
export const sessionCookieName = origin => localCookieName('operator_session_local', origin);
