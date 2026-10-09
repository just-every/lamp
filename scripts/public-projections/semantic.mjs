// Only exact reviewed original member identities can change comparison presentation.
// Unknown identities, executable modes, additions and meaningful differences survive.
export function semanticComparison(result, receipt) {
  const members = new Map(receipt.members.map(m => [m.path, m]));
  const identity = (name, value) => {
    const entry = members.get(name);
    if (!entry || !value || value.sha256 !== entry.originalSha256) return value;
    if (entry.projectedSha256 === null && value.executable !== entry.executable) return value;
    return entry.projectedSha256 === null ? null : {...value, sha256: entry.projectedSha256};
  };
  const differences = rows => rows === null ? null : rows.flatMap(row => {
    const before = identity(row.path, row.before), after = identity(row.path, row.after);
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [{...row, change: !before ? 'added' : !after ? 'removed' : 'modified', before, after}];
  });
  return {component: result.component, upstreamChanges: differences(result.upstreamChanges), localChanges: differences(result.localChanges), currentFiles: result.currentFiles, mappings: result.mappings, meaning: result.meaning};
}
