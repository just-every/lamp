import type { OperatorAuth } from "@runeditrun/rer/modules/operator-auth";
import { createManagementTokenRepository } from "./repository";
export function createManagementApiService(db:D1Database,auth:()=>OperatorAuth) {
  const repository=createManagementTokenRepository(db);
  return {
    isManager:repository.isManager,
    list:repository.list,
    async create(request:Request,input:{name:string;scopes:Array<"metrics:write">;expiresInSeconds:number},actor:string,version:number) {
      const credential=await auth().mintCredential(request,{expiresInSeconds:input.expiresInSeconds});
      try {
        if(!await repository.create({...credential,name:input.name,scope:input.scopes[0]??null},actor,version))throw new Error("Token authority changed. Reload before issuing another token.");
      } catch(cause) {
        await repository.discardUnscopedCredential(credential.id,actor);
        throw cause;
      }
      return {token:credential.token,credential:(await repository.get(credential.id))!};
    },
    revoke:repository.revoke,
    async authenticate(request:Request) {
      const authority=await auth().authenticateCredential(request);
      if(!authority || !await repository.isManager(authority.personId))return null;
      const token=await repository.get(authority.id);
      if(!token || token.issuerId!==authority.personId || token.revokedAt!==null)return null;
      return {authority,token};
    },
  };
}
export type ManagementApiService=ReturnType<typeof createManagementApiService>;
