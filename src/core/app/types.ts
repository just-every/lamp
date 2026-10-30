export interface OperatorIdentity {
  id: string;
  email: string;
  displayName: string;
}

export interface AppBindings {
  /** Holds background delivery and channel sends in their durable outboxes during a move. */
  EFFECTS_PAUSED?: string;
  RER_DEMO?: string;
  RER_DEMO_EXPIRES?: string;
  OWNER_EMAIL?: string;
  RER_OWNER_CLAIM_PUBLIC_KEYS?: string;
  RER_OWNER_CLAIM_ISSUER?: string;
  RER_OWNER_CLAIM_INSTALLATION_ID?: string;
  /** The app origin RER's door trust names; absent means Lamp's own origin. */
  RER_OWNER_CLAIM_APP_ORIGIN?: string;
  /** `on` only on installs RER provisions for a Business plan: the first owner claim opens the import door. */
  RER_IMPORT_DOOR?: string;
  SETUP_TOKEN?: string;
  SESSION_SECRET?: string;
  INSTALLATION_KEY?: string;
  INSTALLATION_KEY_PREVIOUS?: string;
  SETUP_OPERATOR_EMAIL?: string;
  AUTH_ORIGIN?: string;
  AUTH_LOCAL?: string;
  LAMP_LOCAL_ORIGIN?: string;
  RER_DEV_ORIGIN?: string;
  RER_DEV_KEY?: string;
  RER_DEV_IDENTITY?: string;
  IDENTITY_PROVIDER?: string;
  OIDC_TRANSACTION_SECRET?: string;
  AUTH_PROVIDERS?: string;
  RER_MANAGEMENT_ORIGIN?: string;
  RER_INSTALLATION_ID?: string;
  /** Owner-selected external watch; absent means off. Treat capability URLs as secrets. */
  LAMP_HEARTBEAT_URL?: string;
  LAMP_HEARTBEAT_INTERVAL_MINUTES?: string;
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
  SNAPSHOT_CACHE: DurableObjectNamespace;
  JOBS: Queue<import("../platform/jobs").LampJob>;
  ASSETS: Fetcher;
  /** Set by a deploy that records its identity; /health reports them (Base deploymentHealth). */
  RER_DEPLOY_SOURCE?: string;
  RER_DEPLOY_FINGERPRINT?: string;
  RER_VERSION?: { id: string };
  LAMP_PAGE_HOST: string;
  LAMP_APP_HOST: string;
  MAIL_FROM_ADDRESS: string;
  MAIL_PROVIDER_API_KEY?: string;
  MAIL_PROVIDER?: "rer" | "resend" | "sendgrid" | "mailgun" | "ses" | "postmark";
  MAIL_SECONDARY_PROVIDER?: "resend" | "sendgrid" | "mailgun" | "ses" | "postmark";
  MAIL_SECONDARY_API_KEY?: string;
  SES_REGION?: string;
  SES_CONFIGURATION_SET?: string;
  POSTMARK_ACCOUNT_API_KEY?: string;
  SES_EVENT_TOPIC_ARN?: string;
  POSTMARK_WEBHOOK_SECRET?: string;
  MAILGUN_REGION?: "us" | "eu";
  MAILGUN_WEBHOOK_SIGNING_KEY?: string;
  MAIL_FROM?: string;
  MAIL_RELAY_URL?: string;
  MAIL_API_KEY?: string;
  SENDGRID_WEBHOOK_PUBLIC_KEY?: string;
  RER_MAIL_RELAY_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_MESSAGING_SERVICE?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_SIGNING_SECRET?: string;
  SUBSCRIBER_TOKEN_SECRET?: string;
  WEBHOOK_SIGNING_SECRET?: string;
  RESEND_WEBHOOK_SECRET?: string;
  AI_PROVIDER_URL?: string;
  AI_PROVIDER_API_KEY?: string;
  AI_PROVIDER_MODEL?: string;
  /** Local Vite development only: a loopback stand-in for api.statuspage.io. */
  LAMP_DEV_STATUSPAGE_ORIGIN?: string;
  /** Local Vite development only: a loopback stand-in for the internet when Lamp reads the owner's website. */
  LAMP_DEV_SITE_ORIGIN?: string;
  /** Local Vite development only: a loopback receiver standing in for Slack and Teams. */
  LAMP_DEV_CHANNEL_RECEIVER?: string;
  LAMP_DEV_SOCIAL_RECEIVER?: string;
}

export interface AppVariables {
  operator: import("../features/operators/repository").StoredOperator;
  operatorSession: import("@runeditrun/rer/modules/operator-auth").Session;
}

export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}
