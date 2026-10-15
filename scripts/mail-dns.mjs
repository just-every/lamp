import { promises as dns } from "node:dns";

function tags(record) {
  return new Map(record.split(";").map(part => {
    const separator = part.indexOf("=");
    return [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
  }).filter(([name]) => name));
}

export async function assertMailDns(config) {
  const domain = config.mailFromAddress.slice(config.mailFromAddress.lastIndexOf("@") + 1);
  const dkimHost = `${config.mailDkimSelector}._domainkey.${domain}`;
  const dmarcHost = `_dmarc.${domain}`;
  const dkimHelp = `Add or repair the DKIM record at ${dkimHost}: publish the CNAME target supplied by ${config.mailProvider === "sendgrid" ? "SendGrid Domain Authentication" : "your mail provider"}, or its DKIM TXT record with a non-empty p= public key. Set MAIL_DKIM_SELECTOR to that record's selector.`;
  const dmarcHelp = `Add or repair the TXT record at ${dmarcHost} with v=DMARC1; p=none (or your chosen quarantine/reject policy).`;
  async function txt(host, label, help) {
    try {
      // DNS resolution follows provider-managed CNAMEs to their TXT keys.
      return (await dns.resolveTxt(host)).map(parts => parts.join(""));
    } catch (cause) {
      throw new Error(`MAIL_FROM_ADDRESS domain ${domain} has no reachable ${label} TXT record at ${host} (${cause.code ?? "DNS lookup failed"}). ${help}`);
    }
  }
  const dkim = await txt(dkimHost, "DKIM", dkimHelp);
  const keys = dkim.map(tags).filter(record => record.has("p"));
  if (keys.length !== 1 || (keys[0].has("v") && keys[0].get("v").toUpperCase() !== "DKIM1") || !/^[A-Za-z0-9+/]+={0,2}$/.test(keys[0].get("p").replace(/\s/g, ""))) {
    throw new Error(`MAIL_DKIM_SELECTOR ${config.mailDkimSelector} has no usable DKIM public key for ${domain}. ${dkimHelp}`);
  }
  const dmarc = await txt(dmarcHost, "DMARC", dmarcHelp);
  const policies = dmarc.filter(record => /^v=DMARC1\s*(;|$)/i.test(record.trim())).map(tags);
  if (policies.length !== 1 || !["none", "quarantine", "reject"].includes(policies[0].get("p")?.toLowerCase())) {
    throw new Error(`MAIL_FROM_ADDRESS domain ${domain} has no valid DMARC policy. ${dmarcHelp}`);
  }
  // Aligned DKIM can satisfy DMARC on its own. SPF authenticates the envelope
  // sender (return-path), which providers such as SendGrid put on a subdomain.
  // Requiring SPF at the visible From domain rejects that standard setup.
}
