import { execFileSync } from 'node:child_process';

export function cleanSourceIdentity() {
  const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Verification evidence requires a clean source checkout. Commit source changes first.');
  return { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) };
}

export function validateVerificationEvidence(receipt, source) {
  if (receipt?.version !== 1 || receipt.kind !== 'lamp-full-verification'
    || receipt.commit !== source.commit || receipt.tree !== source.tree
    || JSON.stringify(receipt.command) !== JSON.stringify(['pnpm', 'run', 'verify'])
    || receipt.exitCode !== 0 || !Number.isFinite(Date.parse(receipt.finishedAt))) {
    throw new Error('Remote verification evidence does not prove successful full verification of this exact source.');
  }
}

export function verifyRemoteEvidence(host, path) {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host)
    || typeof path !== 'string' || !/^\/[a-zA-Z0-9_./-]+\.json$/.test(path) || path.includes('/../')) {
    throw new Error('Use a trusted SSH host and an absolute remote JSON receipt path.');
  }
  const source = cleanSourceIdentity();
  let receipt;
  try {
    // SSH's existing host-key policy authenticates the owner's verification
    // machine. A local JSON file can never substitute for remote evidence.
    receipt = JSON.parse(execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', host, `cat '${path}'`], { encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch { throw new Error('Could not retrieve verification evidence from the trusted SSH host.'); }
  validateVerificationEvidence(receipt, source);
  return source;
}
