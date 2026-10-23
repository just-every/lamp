// Lamp's archive policy for rer export and rer import (localPortability's
// policyModule, loaded by the transfer worker in its own process).

// Base import-kit custody holds source copies and replay authority: resume and
// undo of a move-in stay on the installation that ran it.
const importCustody=['sorry_import_releases','ik_door_%','ik_batches','ik_d1_assertions','ik_d1_creation_plans','ik_d1_custody_revisions','ik_d1_custody_states','ik_d1_entries','ik_d1_erased_sources','ik_d1_erased_targets','ik_d1_erasure_journal','ik_d1_erasure_progress','ik_d1_erasure_tally','ik_d1_history','ik_d1_indexed_jobs','ik_d1_native_staging','ik_d1_native_staging_index','ik_d1_native_staging_values','ik_d1_original_chunks','ik_d1_plan_chunks','ik_d1_plan_index','ik_d1_preparation_receipts','ik_d1_preparation_steps','ik_d1_publication_fences','ik_d1_retirements','ik_d1_reversal_fences','ik_d1_reversal_reports','ik_d1_staging','ik_d1_staging_chunks','ik_d1_staging_headers','ik_d1_staging_index','ik_d1_staging_originals','ik_d1_staging_pages','ik_d1_stream_origins','ik_d1_stream_pages','ik_d1_stream_revisions','ik_d1_stream_sources','ik_d1_streams','ik_jobs','ik_original_sets','ik_originals','ik_provenance','ik_sources','ik_stages','ik_targets'];

// Durable Base identity and consumed-claim state must travel with Lamp's product
// attribution. Base excludes oa_/oc_ by default; keep only durable authority,
// never sessions, links, credentials or pending setup/dependency approvals.
// Base still forces restored provider links to re-link and sign-in to remain off.
const operatorContinuity=['oa_operators','oa_bootstrap','oa_external_identities','oa_invitation_cancellations','oa_domain_rules','oa_auth_settings','oa_auth_audit','oa_identity_providers','oa_logout_events','oc_owner_claims','oc_idp_grants'];

export default {
  // The archive format's product identity, not the repository identifier: keep it
  // stable so exports made before the repository rename still restore.
  product: 'just-every/lamp',
  buckets: { SNAPSHOTS: {} },
  // A RER Managed page initializer's page_settings row (a random feed id) is a
  // bootstrap row the restore replaces.
  replaceableTables: ['public_snapshot_work', 'snapshot_build_control', 'reference_counters', 'page_settings'],
  includeTables: operatorContinuity,
  excludeTables: ['subscriber_oauth_states', 'chat_link_codes', 'chat_previews', 'chat_requests', 'oa_sessions', 'oa_tokens', 'oa_step_up_challenges', 'oa_credentials', 'oa_dev_credentials', ...importCustody],
  requiredConfiguration: ['SETUP_TOKEN', 'SESSION_SECRET', 'SUBSCRIBER_TOKEN_SECRET', 'WEBHOOK_SIGNING_SECRET'],
  // A PagerDuty source's sealed REST key never travels, as in the hosted archive
  // (scripts/export.mjs): the column stays, so earlier archives still restore, and
  // the restored source asks the owner to reconnect.
  exportRow: (table, row) => table === 'alert_sources' && row.responder_sealed_credentials != null ? { ...row, responder_sealed_credentials: null } : row,
};
