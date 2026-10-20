import { readSite } from "../../platform/site-reader/index.ts";

/** The site reader as Lamp runs it. In local Vite development only, a loopback
 * stand-in can play the internet: every request goes to it with the original
 * host in X-Lamp-Site-Host, and every name resolves to a public address. */
export function websiteReader(devSiteOrigin: string | undefined) {
  if (!devSiteOrigin) return (input: string) => readSite(input);
  return (input: string) => readSite(input, {
    resolve: async () => ["93.184.215.14"],
    fetch: async (url, init) => {
      const target = new URL(String(url));
      const headers = new Headers(init?.headers);
      headers.set("X-Lamp-Site-Host", target.host);
      return fetch(`${devSiteOrigin}${target.pathname}${target.search}`, { ...init, headers });
    },
  });
}
