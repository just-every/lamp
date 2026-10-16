declare module '*modules/mail/index.mjs' {
  export function createMailSender(config: { provider: 'rer'; mode: 'production'; apiKey: string; relayUrl: string }): {
    send(message: { deliveryId: string; messageKey: string; from: string; to: string[]; subject: string; text: string; html?: string; headers: Record<string, string> }): Promise<{
      status: 'accepted' | 'rejected' | 'rate_limited' | 'uncertain';
      providerMessageId: string | null;
      code?: string;
    }>;
  };
}
