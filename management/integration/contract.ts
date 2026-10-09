/** Public integration API v1. Type-only; reviewed adapters receive narrow pure host operations. */
export type Environment = 'production' | 'preview';
export interface SurfaceAddress {workerName:string;hostname:string;path:string}
export interface DeliveryAddresses {kind:'workers_dev'|'custom_domains';subdomain:string;createSubdomain:boolean;app:SurfaceAddress;page?:SurfaceAddress;websitePreview?:SurfaceAddress;customDomains?:Partial<Record<'app'|'page'|'websitePreview',string>>}
export interface ResourcePlan {
  schema: 1;
  workerName: string;
  environment: Environment;
  addresses?:DeliveryAddresses;
  configurationRevision?:string;
  candidateConfiguration?:{publicVariables:Record<string,string>;requiredSecretNames:string[];optionalSecretNames:string[]};
  resources: Array<{ kind: 'd1' | 'r2' | 'queue'; binding: string; name: string }>;
  migrations: Array<{ binding: string; name: string; sha256: string; sql: string }>;
  compatibilityDate: string;
  compatibilityFlags: string[];
  durableObjects: Array<{ binding: string; className: string }>;
  durableObjectMigrations: Array<{tag:string;newSqliteClasses?:string[];newClasses?:string[];deletedClasses?:string[];renamedClasses?:Array<{from:string;to:string}>;transferredClasses?:Array<{from:string;fromScript:string;to:string}>}>;
  publicVariables: Record<string, string>;
  secretNames: string[];
  schedules: string[];
  queueConsumers: Array<{ binding:string; maxBatchSize:number; maxBatchTimeout:number; maxRetries:number; deadLetterBinding?:string }>;
  healthPath: string;
  recovery: string;
  previewEffects?: { schedulesDisabled: true; controlledProviders: string[] };
}

export interface IntegrationProfile {
 id:string; name:string; sourceRepository:string; artifactFile:string; artifactNamePrefix:string;
 compiler:string; requiredPublicInputs:readonly string[]; ownerSetup:string; providerSetup:readonly string[]; operationalGaps:readonly string[];
}
export interface IntegrationHost {
 sha256(value:string):Promise<string>;
 validatePlan(plan:ResourcePlan):Promise<void>;
}
export interface RevisionInput {publicVariables:Record<string,string>;secretNames:string[];controlledProviders?:string[]}
export interface ProjectIntegration {
 profile:IntegrationProfile;
 sourceEnvironmentPrefix:string;
 surfaces:Partial<Record<'app'|'page'|'websitePreview',string>> & {app:string};
 fixedVariables:readonly string[];
 generatedConfiguration(addresses:DeliveryAddresses,managementOrigin:string):Record<string,string>;
 generatePlan(installationId:string,environment:Environment,config:Record<string,unknown>,request?:typeof fetch):Promise<ResourcePlan>;
 revisePlan(plan:ResourcePlan,input:RevisionInput,request?:typeof fetch):Promise<void>;
 validateAddresses(plan:ResourcePlan):void;
}
