export interface OperatorIdentity {
  id: string;
  email: string;
  displayName: string;
}

export interface AppBindings {
  LAMP_BOOTSTRAP_SECRET?: string;
  RER_MANAGEMENT_ORIGIN?: string;
  RER_INSTALLATION_ID?: string;
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
  /** Local Vite development only; never part of deployment or archive storage. */
  LAMP_DEV_OUTBOX?: R2Bucket;
  SNAPSHOT_CACHE: DurableObjectNamespace;
  JOBS: Queue<import("../platform/jobs").LampJob>;
  ASSETS: Fetcher;
  LAMP_PAGE_HOST: string;
  LAMP_APP_HOST: string;
  MAIL_FROM_ADDRESS: string;
  MAIL_PROVIDER_API_KEY?: string;
  MAIL_PROVIDER?: "resend" | "sendgrid";
  SENDGRID_WEBHOOK_PUBLIC_KEY?: string;
  RER_MAIL_RELAY_SECRET?: string;
  SUBSCRIBER_TOKEN_SECRET?: string;
  WEBHOOK_SIGNING_SECRET?: string;
  RESEND_WEBHOOK_SECRET?: string;
  AI_PROVIDER_URL?: string;
  AI_PROVIDER_API_KEY?: string;
  AI_PROVIDER_MODEL?: string;
}

export interface AppVariables {
  operator: OperatorIdentity;
}

export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}
