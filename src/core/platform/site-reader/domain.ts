/** The registrable part of a host name, roughly: getharvest.com, example.co.uk. */
export function siteDomain(host: string) {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  const take = labels.length >= 3 && labels.at(-2)!.length <= 3 && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(-take).join(".");
}

