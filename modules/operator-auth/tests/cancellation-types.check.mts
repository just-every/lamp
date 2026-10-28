import { type OperatorAuth, type Operator } from '../index.mjs';
declare const auth: OperatorAuth;
declare const request: Request;
const cancelled: Promise<Operator> = auth.cancelInvitation(request, 'operator-id');
void cancelled;
// @ts-expect-error cancellation needs an operator ID, never an email or credential object
auth.cancelInvitation(request, { token: 'opaque' });
