// A local artifact build needs every native application input, but no provider
// authority. The full operations descriptor remains the real deployment policy.
export function dryRunInputFailure(descriptor, env) {
  const missing = descriptor.requiredEnvironment.filter(name =>
    !["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"].includes(name)
    && (typeof env[name] !== "string" || !env[name].trim()));
  if (!missing.length) return null;

  const documentation = descriptor.documentation?.document ?? "OPERATIONS.md";
  // The deploy argv is the rer command, which takes its flags directly.
  const command = [...descriptor.commands.deploy.argv, "--dry-run"]
    .map(argument => /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
      ? argument : `'${argument.replaceAll("'", "'\\''")}'`).join(" ");
  return [
    "Missing inputs are expected before a deployment is configured.",
    "The local dry run requires these application inputs:",
    ...missing.map(name => `  ${name} — ${descriptor.environmentSources?.[name] ?? `see ${documentation}`}`),
    "Configuration is checked again once these inputs are set.",
    `Next: read ${documentation}, set the missing inputs, then run ${command}.`,
  ].join("\n");
}
