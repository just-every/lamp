# Retained releases

Each published release keeps its `RELEASE.json` record (`VERSION.json`) and the
exact `CONTRACT.md` it shipped with (`VERSION.CONTRACT.md`). The release check
compares the current contract and migrations with this chain, so every changed
guarantee and every new migration is recorded once. Records here never change.
