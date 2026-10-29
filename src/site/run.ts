import { checkRunData, type RunData } from '../base/run-site';
import { runPricing } from '../base/run-pricing';

// Lamp's repository and listing; Base supplies the chooser, recipe and pricing.
export const run: RunData = checkRunData({
  name: 'Lamp',
  repository: 'https://github.com/just-every/run-lamp',
  clone: 'npx -y @runeditrun/rer dev just-every/run-lamp',
  licence: 'MIT',
  docs: true,
  paths: { product: null },
  pricing: runPricing,
});
