import { stopChild } from './private.mjs';

// Retain ChildProcess identities, never bare PIDs that can outlive their owner.
export function createAppProcesses(){
 const children=new Map();let stopping=false;
 const register=child=>{
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null||children.has(child))return;
  const exited=new Promise(resolve=>child.once('exit',()=>{children.delete(child);resolve();}));
  children.set(child,exited);
  if(stopping)stopChild(child);
 };
 const stop=async()=>{
  stopping=true;
  while(children.size){
   const exited=[...children.values()];
   for(const child of children.keys())stopChild(child);
   await Promise.all(exited);
  }
 };
 return {register,stop};
}
