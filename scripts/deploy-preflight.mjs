// The hosted inputs in the order docs/deploy.md asks for them, each in the
// words its step uses. A dry run names exactly the missing ones by these names.
export const DEPLOY_GUIDE = "docs/deploy.md (https://run-lamp.com/docs/deploy)";

export const deployInputs = [
  { name: "CLOUDFLARE_ACCOUNT_ID", step: 2, words: "your Cloudflare account ID, from the account home page in the Cloudflare dashboard" },
  { name: "CLOUDFLARE_API_TOKEN", step: 2, words: "a Cloudflare API token with the four Edit permissions step 2 lists" },
  { name: "LAMP_APP_HOST", step: 3, words: "the address you and your team sign in at" },
  { name: "LAMP_PAGE_HOST", step: 3, words: "the address your customers read your status page at" },
  { name: "LAMP_PAGE_NAME", step: 4, words: "your status page's name, such as Acme Status" },
  { name: "LAMP_PAGE_TAGLINE", step: 4, words: "one sentence under the name, such as Service updates for Acme customers" },
  { name: "LAMP_PAGE_TIMEZONE", step: 4, words: "the time zone your page shows times in, such as Europe/London" },
  { name: "LAMP_ACCENT_COLOR", step: 4, words: "your brand colour as # and six hex digits, such as #16794C" },
  { name: "SETUP_OPERATOR_EMAIL", step: 5, words: "your email address: you become the page's owner and sign in with it" },
  { name: "MAIL_FROM_ADDRESS", step: 6, words: "the address your page's email comes from, on a domain you authenticated at SendGrid or Resend" },
  { name: "MAIL_DKIM_SELECTOR", step: 6, words: "the DKIM selector your mail provider gave that domain (SendGrid: s1; Resend: resend)" },
  { name: "MAIL_PROVIDER_API_KEY", step: 6, words: "your SendGrid or Resend API key that can send mail" },
  { name: "MAIL_FROM", step: 6, words: "Managed hosting only: the sender address Run Edit Run assigned" },
  { name: "MAIL_RELAY_URL", step: 6, words: "Managed hosting only: the mail relay address Run Edit Run assigned" },
  { name: "MAIL_API_KEY", step: 6, words: "Managed hosting only: the mail key Run Edit Run assigned" },
];

const cloudflare = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"];
const line = name => {
  const input = deployInputs.find(entry => entry.name === name);
  return input ? `  ${name} — step ${input.step}: ${input.words}` : `  ${name} — see ${DEPLOY_GUIDE}`;
};
const blank = (env, name) => typeof env[name] !== "string" || !env[name].trim();
// The guide's order first; anything else required (rer generates the signing
// secrets before a deploy hook runs) follows by name.
export function missingDeployInputs(descriptor, env) {
  const guided = deployInputs.map(entry => entry.name).filter(name => descriptor.requiredEnvironment.includes(name));
  return [...guided, ...descriptor.requiredEnvironment.filter(name => !guided.includes(name))].filter(name => blank(env, name));
}

/** The Cloudflare inputs a dry run does not need but the real deploy does, by name. */
export function realDeployNotice(env) {
  const missing = cloudflare.filter(name => blank(env, name));
  return missing.length ? ["The real deploy also needs:", ...missing.map(line)].join("\n") : null;
}

// A local artifact build needs every native application input, but no provider
// authority. The full operations descriptor remains the real deployment policy.
export function dryRunInputFailure(descriptor, env) {
  const missing = missingDeployInputs(descriptor, env).filter(name => !cloudflare.includes(name));
  if (!missing.length) return null;
  // The deploy argv is the rer command, which takes its flags directly.
  const command = [...descriptor.commands.deploy.argv, "--dry-run"]
    .map(argument => /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
      ? argument : `'${argument.replaceAll("'", "'\\''")}'`).join(" ");
  return [
    "Missing inputs are expected before a deployment is configured.",
    `Set these in your private input file; ${DEPLOY_GUIDE} explains each, in this order:`,
    ...missing.map(line),
    ...[realDeployNotice(env)].filter(Boolean),
    `Next: set the missing inputs, then run ${command} --environment <name> --env-file <your input file> again.`,
  ].join("\n");
}

export function realDeployInputFailure(descriptor, env) {
  const missing = missingDeployInputs(descriptor, env);
  if (!missing.length) return null;
  // Names and the guide's words only: a value never reaches the terminal.
  return ["Missing deployment inputs:", ...missing.map(line), `Set them in your private input file (${DEPLOY_GUIDE}), then run rer deploy again.`].join("\n");
}
