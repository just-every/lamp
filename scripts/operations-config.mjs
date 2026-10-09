import { deploymentConfig } from "./ops-config.mjs";

export function validateConfiguration(env) {
  return deploymentConfig(env);
}
