export async function bootstrapOwner(origin,input,secret,signal) {
 const status=await fetch(new URL('/setup/status',origin),{signal,redirect:'error'});
 if(status.status===200) {
  // A resume never changes an existing owner, page or allow-list.
  return {existing:true};
 }
 if(status.status!==409)throw Error('The installation is not ready for owner setup. Check its deployment health.');
 const response=await fetch(new URL('/setup',origin),{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify({email:input.ownerEmail,displayName:input.displayName,pageName:input.pageName,tagline:input.tagline,timezone:input.timezone,mailProvider:input.mailProvider,mailFromAddress:input.mailFrom})});
 if(response.status!==201)throw Error('Owner setup was refused. Check the installation secret, provider settings and health.');
 return {existing:false};
}
