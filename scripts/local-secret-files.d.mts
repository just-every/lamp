import type { Plugin } from 'vite';
export function localSecretsStayLocal(): Plugin;
export function assertNoLocalSecretFiles(directory?: string): Promise<void>;
