import { fetchSavedResponses, readSavedResponses, type SavedFile } from './source';
import { fetchBetterStack } from './betterstack/fetch';
import { readBetterStack } from './betterstack/read';

export type ImportSource = 'statuspage' | 'betterstack';
export interface SourceInput { source?: ImportSource; files?: SavedFile[]; pageId?: string; apiKey?: string; publicAccessAcknowledged?: boolean }
/** A reader is the source-specific boundary; plans, native targets and journals are shared. */
export const sourceAdapters = {
  statuspage: { label: 'Statuspage', read: (files: SavedFile[], _input: SourceInput) => readSavedResponses(files), fetch: (input: { pageId: string; apiKey: string }, origin?: string) => fetchSavedResponses({ ...input, origin }) },
  betterstack: { label: 'Better Stack', read: readBetterStack, fetch: (input: { pageId: string; apiKey: string }) => fetchBetterStack(input) },
};
export function sourceAdapter(source: ImportSource = 'statuspage') { return sourceAdapters[source]; }
