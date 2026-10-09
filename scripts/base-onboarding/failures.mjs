// Only this module can mark a failure as safe for the browser. Never render a
// caught error's message, code, cause, command, arguments, output or environment.
const approved = new WeakMap();
const tools = Object.freeze({node:'Node.js',npm:'npm',pnpm:'pnpm',git:'Git'});
const steps = Object.freeze({dependencies:'installing dependencies',setup:'setting up the application',build:'building the application',verify:'verifying the application',start:'starting the application',deploy:'deploying the application'});
export function installationFailure(code, details = {}) {
 let message;
 if(code==='node_version' && typeof details.version==='string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(details.version) && !details.version.includes('\n')) {
  message=`Install Node.js ${details.version}, then restart this installer with that version and resume your saved setup.`;
 } else if(code==='missing_tool' && typeof details.tool==='string' && Object.hasOwn(tools,details.tool)) {
  const action=details.tool==='npm'?'Install Node.js with npm included':`Install ${tools[details.tool]}`;
  message=`${tools[details.tool]} was not found. ${action} and make it available on PATH, then restart this installer and resume your saved setup.`;
 } else if(code==='command_failed' && typeof details.step==='string' && Object.hasOwn(steps,details.step)) {
  message=`Installation stopped while ${steps[details.step]}. Ask your agent to check the edition's operating command for that step, correct the cause, then select Start again. Your setup answers are saved; you may need to supply credentials again.`;
 } else {
  throw new TypeError('Choose a supported installation failure and its documented details.');
 }
 const error=new Error(message);
 approved.set(error,{code,message});
 return error;
}
export function installationFailureMessage(error) {
 return approved.get(error)?.message || 'Installation stopped unexpectedly. Review the last installation step shown here and ask your agent to inspect the edition’s installer and operating commands. After correcting the cause, select Start again. Your setup answers are saved; you may need to supply credentials again.';
}
