export function isLocalPublicRead(method: string, target: string, headers: Pick<Headers, 'get' | 'has'> | Map<string, string>, url: URL): boolean;
