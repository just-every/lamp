// Build outputs are untrusted: credential-bearing files must never be transported.
export function assertArtifactPath(path) {
  const parts = path.replaceAll('\\', '/').split('/');
  for (const part of parts) {
    if (/^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.npmrc|\.yarnrc(?:\.yml)?|\.netrc|\.pypirc|credentials(?:\.(?:json|ini|toml|yaml|yml))?|id_(?:rsa|ed25519)(?:\..*)?)$/i.test(part)) {
      throw new Error(`Artifact cannot contain credential files: ${path}`);
    }
  }
}
