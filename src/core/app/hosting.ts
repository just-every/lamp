import type { AppBindings } from "./types";

/** Managed hosting fills MAIL_PROVIDER=rer. It relays mail only and has no
 * outbound relay for other integrations yet, so those say so and refuse
 * settings that could never send. Free and Assisted installs run in the
 * owner's own Cloudflare account, where outbound calls work. */
export function outboundUnavailable(bindings: AppBindings, what: string): string | null {
  return bindings.MAIL_PROVIDER === "rer"
    ? `${what} need an outbound connection, which Managed hosting does not offer yet. They work on a Free or Assisted installation in your own Cloudflare account.`
    : null;
}
