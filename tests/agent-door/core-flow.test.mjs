import { contract } from '../contract.mjs';
import { runNativeIdentityProofFlow } from './identity-proof-flow.mjs';

contract('AGENT-008', 'Business people remain bound to native identity and native proof', async t => {
  await runNativeIdentityProofFlow(t);
});
