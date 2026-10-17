import { catalogueFromCsv } from "./catalogue-csv";
import { CatalogueChangedError, type CatalogueRepository } from "./catalogue.repository";
import { catalogueSchema, type CataloguePreview, type ComponentCatalogue } from "./catalogue-schema";

async function reviewToken(revision: number, catalogue: ComponentCatalogue) {
  const bytes = new TextEncoder().encode(JSON.stringify({ revision, catalogue }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function counts(previous: Array<{ id: string }>, next: Array<{ id: string }>) {
  const old = new Map(previous.map(item => [item.id, item]));
  const ids = new Set(next.map(item => item.id));
  return {
    created: next.filter(item => !old.has(item.id)).length,
    changed: next.filter(item => old.has(item.id) && JSON.stringify(old.get(item.id)) !== JSON.stringify(item)).length,
    deleted: previous.filter(item => !ids.has(item.id)).length,
  };
}

export function createCatalogueService(repository: CatalogueRepository, onPublicDataChanged: () => Promise<void>) {
  return {
    read: () => repository.read(),
    async preview(input: { csv: string } | { catalogue: ComponentCatalogue; revision: number }): Promise<CataloguePreview> {
      const previous = await repository.read();
      if ("catalogue" in input && input.revision !== previous.revision) throw new CatalogueChangedError();
      const catalogue = "csv" in input ? catalogueFromCsv(input.csv, previous.catalogue) : catalogueSchema.parse(input.catalogue);
      return {
        revision: previous.revision, catalogue,
        reviewToken: await reviewToken(previous.revision, catalogue),
        counts: { components: counts(previous.catalogue.components, catalogue.components), groups: counts(previous.catalogue.groups, catalogue.groups) },
        removed: {
          components: previous.catalogue.components.filter(item => !catalogue.components.some(next => next.id === item.id)).map(item => item.name),
          groups: previous.catalogue.groups.filter(item => !catalogue.groups.some(next => next.id === item.id)).map(item => item.name),
        },
      };
    },
    async apply(input: { catalogue: ComponentCatalogue; revision: number; reviewToken: string }, operatorId: string) {
      const catalogue = catalogueSchema.parse(input.catalogue);
      if (await reviewToken(input.revision, catalogue) !== input.reviewToken) throw new Error("The input changed after review. Preview the current input before applying it.");
      const previous = await repository.read();
      if (previous.revision !== input.revision) throw new CatalogueChangedError();
      await repository.apply(previous, catalogue, operatorId);
      await onPublicDataChanged();
      return repository.read();
    },
  };
}

export type CatalogueService = ReturnType<typeof createCatalogueService>;
