import profile from './profile.json';
import {createPlanGenerator} from './plan';
import {revisePlan} from './revision';
import type {IntegrationHost,ProjectIntegration} from './contract';
export function createIntegration(host:IntegrationHost):ProjectIntegration{return {
 profile,sourceEnvironmentPrefix:'LAMP',surfaces:{app:'/signin',page:'/'},
 fixedVariables:['LAMP_APP_HOST','LAMP_PAGE_HOST','RER_MANAGEMENT_ORIGIN','RER_INSTALLATION_ID'],
 generatedConfiguration:addresses=>({LAMP_APP_HOST:addresses.app.hostname,LAMP_PAGE_HOST:addresses.page!.hostname}),
 generatePlan:createPlanGenerator(host),revisePlan,
 validateAddresses(plan){const a=plan.addresses,v=plan.publicVariables;if(!a?.page||a.websitePreview||v.LAMP_APP_HOST!==a.app.hostname||v.LAMP_PAGE_HOST!==a.page.hostname||a.app.path!=='/signin'||a.page.path!=='/')throw Error('Lamp hosts differ from accepted addresses');},
};}
