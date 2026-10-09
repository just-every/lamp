import {resolve} from 'node:path';
export const specInputs={
 providerEffects:['outbound-mail','ai','outbound-webhooks'],
 surfaces:{app:{path:'/signin',hostnameVariable:'LAMP_APP_HOST'},page:{path:'/',hostnameVariable:'LAMP_PAGE_HOST',readiness:[{path:'/',statuses:[200],pendingSetupStatuses:[503]}]}},
 initialSetup:{path:'/setup/status',pendingStatus:409,completeStatus:200},
 publicVariableNames:['LAMP_PAGE_HOST','LAMP_APP_HOST','MAIL_FROM_ADDRESS','MAIL_PROVIDER','SENDGRID_WEBHOOK_PUBLIC_KEY','AI_PROVIDER_URL','AI_PROVIDER_MODEL','RER_MANAGEMENT_ORIGIN','RER_INSTALLATION_ID','RER_MAIL_RELAY_URL','RER_RELEASE_DIGEST'],
 secretNames:['LAMP_BOOTSTRAP_SECRET','MAIL_PROVIDER_API_KEY','SUBSCRIBER_TOKEN_SECRET','WEBHOOK_SIGNING_SECRET'],optionalSecretNames:['RESEND_WEBHOOK_SECRET','AI_PROVIDER_API_KEY','RER_MAIL_RELAY_SECRET'],
 migrationPrefix:'core-',
 recovery:'Retain source and database backup before migration. Preserve applied migration history. Restore into fresh installation resources and verify owner workflows before switching traffic.',
};
export const extraMigrationDirectories=root=>[{binding:'DB',path:resolve(root,'migrations/ext'),prefix:'ext-',optional:true}];
