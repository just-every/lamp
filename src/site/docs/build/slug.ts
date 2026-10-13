// Heading ids the way GitHub makes them, so a link written for GitHub works on the site too: lowercase, drop everything
// that is not a letter, mark, number, connector, space or hyphen, then spaces become hyphens. A repeat gets -1, -2 and so
// on. One slugger per page: the counts are per page.
export function createSlugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    let slug = base;
    while (seen.has(slug)) {
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      slug = `${base}-${count}`;
    }
    seen.set(slug, 0);
    return slug;
  };
}
