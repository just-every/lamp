import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
export function inspectIngress(request: IncomingMessage): string | null;
export function developmentIngress(enabled?: boolean, persistStatePath?: string): Plugin;
