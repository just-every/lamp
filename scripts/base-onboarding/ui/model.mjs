import * as seed from './seed.mjs';
import { createModel } from './model-core.mjs';
export const { fields, safeKeys, product, branding, features, normalizeWebsite, safeDraft, initialDraft, secretReady, configuredEmailReady, hostingKeys, hostingModel, setupModel, installInput, displayValue, mergeAgentDraft, derivePrefix, normalizeAutomaticDraft, emailModel, setupGroups, readySummary, nextIncompleteGroup, setupProgress } = createModel(seed);
