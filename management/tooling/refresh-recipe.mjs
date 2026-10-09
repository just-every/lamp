import {createHash} from 'node:crypto';
import {lampPlan} from './compile-plan.mjs';
import {writeFile} from 'node:fs/promises';
const plan=await lampPlan({installationId:'recipe',environment:'production',variables:{LAMP_PAGE_HOST:'page.recipe.invalid',LAMP_APP_HOST:'app.recipe.invalid',LAMP_PAGE_NAME:'RER_RECIPE_NAME',LAMP_PAGE_TAGLINE:'RER_RECIPE_TAGLINE',LAMP_PAGE_TIMEZONE:'Australia/Brisbane',LAMP_ACCENT_COLOR:'#112233',MAIL_FROM_ADDRESS:'mail@recipe.invalid',SETUP_OPERATOR_EMAIL:'owner@recipe.invalid',MAIL_PROVIDER:'sendgrid'}});
let sql=plan.migrations.at(-1).sql;sql=sql.replace(/'[0-9A-HJKMNP-TV-Z]{26}'/g,"'RER_RECIPE_OWNER_ID'").replace(/'\d{4}-\d\d-\d\dT[^']+'/g,"'RER_RECIPE_TIMESTAMP'");plan.migrations.at(-1).sql=sql;plan.migrations.at(-1).sha256=createHash('sha256').update(sql).digest('hex');
await writeFile(new URL('../integration/recipe.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
