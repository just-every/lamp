import { fetchSorryResponses, fetchSorryPublicResponses, readSorryResponses } from './sorry';
import { fetchSavedResponses, readSavedResponses, type SavedFile } from './source';
import { fetchBetterStack } from './betterstack/fetch';
import { readBetterStack } from './betterstack/read';
import { fetchInstatusResponses } from './instatus/api';
import { readInstatusResponses } from './instatus/normalize';

export type ImportSource = 'statuspage' | 'betterstack' | 'instatus' | 'sorry';
export interface SourceInput { source?: ImportSource; files?: SavedFile[]; pageId?: string; apiKey?: string; publicAccessAcknowledged?: boolean; publicUrl?: string; previewNoticeLimit?: number }
/** A reader is the source-specific boundary; plans, native targets and journals are shared. */
export const sourceAdapters = {
  sorry: { label: 'Sorry', read: readSorryResponses, fetch: (input: { pageId: string; apiKey: string }) => fetchSorryResponses(input) },
  statuspage: { label: 'Statuspage', read: (files: SavedFile[], _input: SourceInput) => readSavedResponses(files), fetch: (input: { pageId: string; apiKey: string }, origin?: string) => fetchSavedResponses({ ...input, origin }) },
  instatus: { label: 'Instatus', read: readInstatusResponses, fetch: (input: { pageId: string; apiKey: string }) => fetchInstatusResponses(input) },
  betterstack: { label: 'Better Stack', read: readBetterStack, fetch: (input: { pageId: string; apiKey: string }) => fetchBetterStack(input) },
};
export function sourceAdapter(source: ImportSource = 'statuspage') { return sourceAdapters[source]; }
