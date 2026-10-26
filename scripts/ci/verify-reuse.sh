#!/usr/bin/env bash
set -euo pipefail
wf="${WF_REF%@*}"; wf="${wf##*/}"
# Only the newest same-repository push of this workflow can supply evidence.
# A PR may itself be a skip; a dispatch may run only a subset.
newest_push() {
  gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/runs?head_sha=$1&event=push&per_page=100" \
    --jq "[.workflow_runs[] | select(.head_repository.full_name == \"$GITHUB_REPOSITORY\" and .id != $GITHUB_RUN_ID)] | max_by(.id) | select(. != null) | \"\(.status) \(.conclusion)\"" || true
}
green() { [ "$(newest_push "$1")" = 'completed success' ]; }
skip=false
# C1: retain candidate-branch push evidence when its exact SHA reaches main.
if [ "$EVENT" = push ] && [ "$REF" = refs/heads/main ] && green "$GITHUB_SHA"; then skip=true; fi
# C3: an identical parent tree is reusable only with green parent push evidence.
if [ "$skip" = false ] && [ "$EVENT" = push ] && parent=$(git rev-parse -q --verify HEAD~1) \
   && [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'HEAD~1^{tree}')" ] && green "$parent"; then skip=true; fi
# C2: same-repository PRs wait up to 25 minutes for their head's push run.
# Missing, failed, cancelled, fork-only or still-running evidence runs in full.
if [ "$EVENT" = pull_request ] && [ "$SAME_REPO" = true ]; then
  for _ in $(seq 1 50); do
    state=$(newest_push "$PR_HEAD")
    case "$state" in
      'completed success') skip=true; break ;;
      ''|completed\ *) break ;;
      *) sleep 30 ;;
    esac
  done
fi
echo "skip=$skip" >> "$GITHUB_OUTPUT"
