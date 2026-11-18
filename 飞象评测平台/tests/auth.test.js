import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {hashSecret} from '../server/secrets.js';
test('公网认证：管理员会话、个人评测码、跨人员隔离、持久化与失败分数留空',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'edubench-auth-')),password='isolated-test-admin-credential';let child,base,cookie='';
 async function start(){child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(QWEN|DOUBAO|GLM|GEMINI|DEEPSEEK)_/.test(k))),NODE_ENV:'test',AUTH_REQUIRED:'true',ADMIN_PASSWORD_HASH:hashSecret(password),DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',b=>{out+=b;const m=out.match(/http:\/\/localhost:(\d+)/);if(m){base='http://127.0.0.1:'+m[1];resolve();}});child.once('exit',c=>reject(new Error('server exit '+c)));});}
 async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
 async function req(path,{method='GET',body,admin=false,token,headers={}}={}){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(admin?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};}
 try{await start();assert.equal((await req('/api/admin/state')).status,401);assert.equal((await req('/api/admin/state',{headers:{'X-Forwarded-For':'127.0.0.1'}})).status,401);
  assert.equal((await req('/api/auth/admin/login',{method:'POST',body:{password:'wrong'}})).status,401);
  const login=await req('/api/auth/admin/login',{method:'POST',body:{password}});assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/SameSite=Strict/);cookie=login.cookie.split(';')[0];assert.ok(!(JSON.stringify(login.data).includes(password)));
  const state=await req('/api/admin/state',{admin:true});assert.equal(state.status,200);assert.ok(!JSON.stringify(state.data).includes('passwordHash'));
  const a=(await req('/api/admin/personnel',{method:'POST',admin:true,body:{name:'测试甲'}})).data,b=(await req('/api/admin/personnel',{method:'POST',admin:true,body:{name:'测试乙'}})).data;
  const ca=(await req(`/api/admin/personnel/${a.id}/code`,{method:'POST',admin:true,body:{}})).data.accessCode,cb=(await req(`/api/admin/personnel/${b.id}/code`,{method:'POST',admin:true,body:{}})).data.accessCode;
  const db=new DatabaseSync(join(dir,'edubench.sqlite'));const cases=state.data.benchmarks[0].cases;const models=state.data.models.filter(m=>m.role==='tested');const snapshot={cases,models,judge:state.data.models.find(m=>m.role==='judge'),dimensions:state.data.dimensions};
  db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?)').run('auth-run','权限隔离测试','','auth-run-token',new Date().toISOString(),'needs_attention',JSON.stringify(snapshot));
  for(const c of cases){db.prepare('INSERT INTO rubrics(runId,caseId,status) VALUES (?,?,?)').run('auth-run',c.id,'done');for(const m of models){const failed=m.id==='glm'&&['Q08','Q09'].includes(c.id);db.prepare('INSERT INTO outputs(id,runId,caseId,modelId,generationStatus,judgeStatus,content,error,autoScore) VALUES (?,?,?,?,?,?,?,?,?)').run(c.id+'-'+m.id,'auth-run',c.id,m.id,failed?'failed':'done',failed?'pending':'done',failed?'截断残稿':'隔离测试协议夹具',failed?'测试失败原因':null,failed?null:JSON.stringify({fulfillment:{score:3},completeness:{score:3}}));}}
  db.close();
  await req('/api/admin/runs/auth-run/reviewers',{method:'PUT',admin:true,body:{assignments:[{personId:a.id,caseIds:['Q01','Q04','Q07']},{personId:b.id,caseIds:['Q02','Q05','Q08']}]}});
  for(const body of [{name:a.name},{name:a.name,accessCode:cb},{name:b.name,accessCode:ca}])assert.equal((await req('/api/review/join',{method:'POST',body})).status,403);
  const joined=await req('/api/review/join',{method:'POST',body:{name:b.name,accessCode:cb}});assert.equal(joined.status,200);const token=joined.data.token;
  let session=(await req('/api/review/session',{token})).data;assert.deepEqual(session.tasks.map(t=>t.case.id),['Q02','Q05','Q08']);assert.equal(session.cases.length,8);assert.equal(session.tasks.at(-1).answers.filter(a=>a.status==='failed').length,1);assert.ok(!JSON.stringify(session).includes(cb));
  assert.equal((await req('/api/admin/state',{token})).status,401);assert.equal((await req('/api/review/score',{method:'POST',token,body:{outputId:'Q01-glm',scores:{accuracy:2,suitability:2,utility:2}}})).status,403);
  assert.equal((await req('/api/review/score',{method:'POST',token,body:{outputId:'Q08-glm',scores:{accuracy:2,suitability:2,utility:2}}})).status,409);
  assert.equal((await req('/api/review/score',{method:'POST',token,body:{outputId:'Q02-glm',scores:{accuracy:2,suitability:2,utility:2}}})).status,200);
  let report=(await req('/api/admin/runs/auth-run',{admin:true})).data.report;assert.equal(report.failures.length,2);for(const r of report.rows.filter(r=>['Q08-glm','Q09-glm'].includes(r.id))){assert.equal(r.total,null);assert.ok(Object.values(r.values).every(v=>v===null));}assert.equal(report.models.find(m=>m.id==='glm').total,null);
  const exported=JSON.stringify((await req('/api/admin/state',{admin:true})).data);assert.ok(!exported.includes(ca)&&!exported.includes(cb)&&!exported.includes('passwordHash'));
  await stop();await start();assert.equal((await req('/api/admin/state',{admin:true})).status,200);session=(await req('/api/review/session',{token})).data;assert.equal(session.cases.find(c=>c.id==='Q02-glm').scores.accuracy,2);
  await req(`/api/admin/personnel/${b.id}/code`,{method:'POST',admin:true,body:{}});assert.equal((await req('/api/review/session',{token})).status,401);assert.equal((await req('/api/review/join',{method:'POST',body:{name:b.name,accessCode:cb}})).status,403);
  assert.equal((await req('/api/auth/admin/logout',{method:'POST',admin:true,body:{}})).status,200);assert.equal((await req('/api/admin/state',{admin:true})).status,401);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
