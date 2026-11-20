import {renameSync,mkdirSync,existsSync,cpSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const route='src/app/api',stash='.export-api';
if(existsSync(stash))throw new Error('Export stash already exists');
try{if(existsSync(route))renameSync(route,stash);const result=spawnSync(process.execPath,['../node_modules/next/dist/bin/next','build'],{stdio:'inherit',env:{...process.env,STATIC_EXPORT:'1'}});if(result.status!==0)process.exitCode=result.status||1;else{mkdirSync('../out',{recursive:true});cpSync('out','../out',{recursive:true});}}finally{if(existsSync(stash))renameSync(stash,route);}
