import { fetchSorryResponses, fetchSorryPublicResponses, readSorryResponses } from './sorry';
import { fetchSavedResponses, readSavedResponses, type SavedFile } from './source';
import { fetchBetterStack } from './betterstack/fetch';
import { readBetterStack } from './betterstack/read';
import { fetchInstatusResponses } from './instatus/api';
import { readInstatusResponses } from './instatus/normalize';

/** Lamp's server-owned import allow-list: every source Move in offers, each one
 * door namespace. The owner's Move in and Business grants share it. */
export const importSources = ['statuspage', 'betterstack', 'instatus', 'sorry'] as const;
export type ImportSource = (typeof importSources)[number];
export const isImportSource = (name: string): name is ImportSource => (importSources as readonly string[]).includes(name);
export interface SourceInput { source?: ImportSource; files?: SavedFile[]; pageId?: string; apiKey?: string; publicAccessAcknowledged?: boolean; publicUrl?: string }
/** A reader is the source-specific boundary; plans, native targets and journals are shared. */
export const sourceAdapters = {
  sorry: { label: 'Sorry', read: readSorryResponses, fetch: (input: { pageId: string; apiKey: string }) => fetchSorryResponses(input) },
  statuspage: { label: 'Statuspage', read: (files: SavedFile[], _input: SourceInput) => readSavedResponses(files), fetch: (input: { pageId: string; apiKey: string }, origin?: string) => fetchSavedResponses({ ...input, origin }) },
  instatus: { label: 'Instatus', read: readInstatusResponses, fetch: (input: { pageId: string; apiKey: string }) => fetchInstatusResponses(input) },
  betterstack: { label: 'Better Stack', read: readBetterStack, fetch: (input: { pageId: string; apiKey: string }) => fetchBetterStack(input) },
};
export function sourceAdapter(source: ImportSource = 'statuspage') { return sourceAdapters[source]; }
