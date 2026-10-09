declare module 'virtual:lamp-dev-ingress' {
  export const enabled: boolean;
  export const authenticate: ReturnType<typeof import('./worker').createDevelopmentAuthenticator>;
}
