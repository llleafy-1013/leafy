// Isolated protocol fixtures only: no external API calls, no writes to the user's database.
import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';
const cases=JSON.parse(readFileSync(new URL('../server/benchmark.json',import.meta.url)));
const rubric={fulfillment:{checks:['核对 Query'],levels:{1:'缺失',2:'基本完成',3:'全部完成'}},completeness:{checks:['结构完整'],levels:{1:'缺失',2:'基本完整',3:'齐全'}},audit:'已核对完整性与去重'};
const score={fulfillment:{score:3,reason:'测试协议夹具'},completeness:{score:2,reason:'测试协议夹具'},issues:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('九题完整链路、重试幂等、匿名独立评分、刷新及重启持久化',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'edubench-test-'));let process,base;let draftCalls=0,auditCalls=0,judgeCalls=0,genCalls=0,failedOnce=false;
 const upstream=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const b=JSON.parse(text);const prompt=b.messages?.at(-1).content??b.input.at(-1).content[0].text;let content;
  if(b.model==='qwen-unit'){const p=JSON.parse(prompt);if(p.action.includes('依据任务生成')){draftCalls++;content=JSON.stringify(rubric);}else if(p.action.includes('独立核对')){auditCalls++;content=JSON.stringify(rubric);}else{judgeCalls++;content=JSON.stringify(score);}}
  else{genCalls++;assert.ok(cases.some(c=>c.query===prompt),'发送 Query 必须与 PRD 完全一致');if(b.model==='deepseek-unit'&&prompt===cases[0].query&&!failedOnce){failedOnce=true;res.writeHead(429,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:{message:'unit transient limit'}}));}content='测试专用协议夹具，品牌 DeepSeek Qwen GLM 豆包。本内容不会写入实际 Demo 数据库。';}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(b.input?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:content}]}],usage:{input_tokens:10,output_tokens:20,total_tokens:30}}:{choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}));
 });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 async function start(){const env={...processEnv(),DATA_DIR:dir,HOST:'127.0.0.1',PORT:'0'};process=spawn(globalThis.process.execPath,['server/index.js'],{cwd:globalThis.process.cwd(),env,stdio:['ignore','pipe','pipe']});let out='';await new Promise((resolve,reject)=>{process.stdout.on('data',b=>{out+=b;const m=out.match(/http:\/\/localhost:(\d+)/);if(m){base=`http://127.0.0.1:${m[1]}`;resolve();}});process.once('exit',c=>reject(new Error('Server exit '+c)));});}
 function processEnv(){return Object.fromEntries(Object.entries(globalThis.process.env).filter(([k])=>!/(QWEN|DOUBAO|GLM|GEMINI|DEEPSEEK)_/.test(k)));}
 async function stop(){if(process&&process.exitCode===null){process.kill('SIGTERM');await once(process,'exit');}}
 async function req(path,{method='GET',body,token,headers={}}={}){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 async function finished(id){for(let i=0;i<150;i++){const {data}=await req('/api/admin/runs/'+id);if(!data.active)return data;await delay(30);}throw new Error('Run timeout');}
 try{await start();let {data:state}=await req('/api/admin/state');assert.equal(state.benchmarks[0].cases.length,9);assert.equal(state.models.length,4);
  assert.equal((await req('/api/admin/runs',{method:'POST',body:{name:'未配置',benchmarkId:'prd-v1'}})).status,400);
  for(const m of state.models){const r=await req('/api/admin/models/'+m.id,{method:'PUT',body:{model:m.id+'-unit',apiKey:'test-only-secret-'+m.id,baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`}});assert.equal(r.status,200);assert.ok(!JSON.stringify(r.data).includes('test-only-secret'));}
  assert.equal((await req('/api/admin/dimensions',{method:'PUT',headers:{Origin:'https://hostile.invalid'},body:{}})).status,403);
  const created=await req('/api/admin/runs',{method:'POST',body:{name:'隔离测试批次',benchmarkId:'prd-v1'}});assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id;let run=await finished(id);assert.equal(run.progress.generated,26);assert.equal(run.status,'needs_attention');assert.equal(draftCalls,9);assert.equal(auditCalls,9);assert.equal(judgeCalls,26);
  assert.equal((await req(`/api/admin/runs/${id}/retry`,{method:'POST',body:{}})).status,200);run=await finished(id);assert.equal(genCalls,28);assert.equal(judgeCalls,27);assert.equal(draftCalls,9);assert.equal(auditCalls,9);assert.equal(run.progress.judged,27);
  assert.equal((await req('/api/review/join',{method:'POST',body:{runToken:run.token,name:'未分配人员'}})).status,403);
  const pa=(await req('/api/admin/personnel',{method:'POST',body:{name:'评审 A'}})).data;
  const pb=(await req('/api/admin/personnel',{method:'POST',body:{name:'评审 B'}})).data;
  const pc=(await req('/api/admin/personnel',{method:'POST',body:{name:'其他人员'}})).data;
  assert.equal((await req('/api/admin/personnel',{method:'POST',body:{name:' 评审 A '}})).status,409);
  assert.equal((await req('/api/admin/runs/'+id+'/reviewers',{method:'PUT',body:{personIds:[pa.id,pb.id]}})).status,200);
  assert.equal((await req('/api/review/join',{method:'POST',body:{runToken:run.token,name:pc.name}})).status,403);
  const a=(await req('/api/review/join',{method:'POST',body:{runToken:run.token,name:'评审 A'}})).data;
  const b=(await req('/api/review/join',{method:'POST',body:{runToken:run.token,name:'评审 B'}})).data;
  const aa=(await req('/api/review/join',{method:'POST',body:{runToken:run.token,name:'评审 A'}})).data;assert.equal(aa.token,a.token);
  const session=(await req('/api/review/session',{token:a.token})).data;assert.equal(session.cases.length,27);assert.equal(session.tasks.length,9);assert.ok(session.tasks.every(t=>t.answers.length===3));assert.equal(session.projects.length,1);assert.equal(session.dimensions.length,3);const dumped=JSON.stringify(session);for(const name of ['modelId','provider','autoScore','apiKey','deepseek-unit','DeepSeek','Qwen','GLM','豆包'])assert.ok(!dumped.includes(name),name+' 不得泄漏');
  assert.equal((await req('/api/review/score',{method:'POST',token:a.token,body:{outputId:session.cases[0].id,scores:{accuracy:4,suitability:2,utility:2}}})).status,400);
  const beforeCodes=session.cases.map(c=>c.code);for(const c of session.cases){assert.equal((await req('/api/review/score',{method:'POST',token:a.token,body:{outputId:c.id,scores:{accuracy:1,suitability:1,utility:1},note:'测试评分'}})).status,200);}
  run=(await req('/api/admin/runs/'+id)).data;assert.equal(run.reviewers.find(v=>v.personId===pa.id).taskDone,9);assert.equal(run.reviewers.find(v=>v.personId===pb.id).taskDone,0);assert.ok(run.reviews.every(x=>x.updated&&x.reviewerId));assert.equal(run.report.models[0].total,null);assert.equal(run.reviews.length,27);
  await stop();await start();const restored=(await req('/api/review/session',{token:a.token})).data;assert.deepEqual(restored.cases.map(c=>c.code),beforeCodes);assert.equal(restored.cases.filter(c=>c.scores).length,27);
  for(const c of restored.cases)await req('/api/review/score',{method:'POST',token:b.token,body:{outputId:c.id,scores:{accuracy:3,suitability:3,utility:3}}});
  run=(await req('/api/admin/runs/'+id)).data;assert.equal(run.status,'completed');assert.equal(run.reviews.length,54);assert.ok(run.report.models.every(m=>Math.abs(m.total-73.3333333333)<1e-6));assert.ok(run.report.models.every(m=>m.rank===1));assert.equal(run.report.rows.filter(r=>r.disputed).length,27);
  const first=restored.cases[0];await req('/api/review/score',{method:'POST',token:a.token,body:{outputId:first.id,scores:{accuracy:2,suitability:2,utility:2}}});assert.equal((await req('/api/admin/runs/'+id)).data.reviews.length,54,'修改评分应覆盖而不重复累计');
  assert.equal(run.report.models[0].groups.subject.length,new Set(cases.map(c=>c.subject)).size);
  assert.ok(run.report.models[0].groups.subject.every(g=>g.values.accuracy!==null));
  assert.equal((await req('/api/admin/personnel/'+pa.id,{method:'PUT',body:{name:'评审 A 改名'}})).status,200);
  assert.equal((await req('/api/review/session',{token:a.token})).data.name,'评审 A 改名');
  assert.equal((await req('/api/review/join',{method:'POST',body:{name:'评审 A'}})).status,403);
  assert.equal((await req('/api/review/join',{method:'POST',body:{name:'评审 A 改名'}})).data.token,a.token);
  await req('/api/admin/runs/'+id+'/reviewers',{method:'PUT',body:{personIds:[pb.id]}});
  assert.equal((await req('/api/review/session',{token:a.token})).status,401);
  assert.equal((await req('/api/review/score',{method:'POST',token:a.token,body:{outputId:first.id,scores:{accuracy:3,suitability:3,utility:3}}})).status,401);
  run=(await req('/api/admin/runs/'+id)).data;assert.equal(run.reviews.length,54);assert.equal(run.allReviewers.length,2);assert.equal(run.reviewers.length,1);assert.equal(run.report.models[0].values.accuracy,3);
  await req('/api/admin/runs/'+id+'/reviewers',{method:'PUT',body:{personIds:[pa.id,pb.id]}});
  assert.equal((await req('/api/review/session',{token:a.token})).data.cases.filter(c=>c.scores).length,27);
  const second=(await req('/api/admin/runs',{method:'POST',body:{name:'仅其他人员可见',benchmarkId:'prd-v1'}})).data;
  await req('/api/admin/runs/'+second.id+'/reviewers',{method:'PUT',body:{personIds:[pc.id]}});
  const other=(await req('/api/review/join',{method:'POST',body:{name:pc.name}})).data;
  const otherSession=(await req('/api/review/session',{token:other.token})).data;
  assert.equal(otherSession.tasks.length,9);assert.equal(otherSession.totalExpected,27);
  assert.equal(otherSession.projects.length,1);assert.equal(otherSession.projects[0].token,other.runToken);
  assert.equal((await req('/api/review/join',{method:'POST',body:{name:'评审 A 改名',runToken:other.runToken}})).status,403);
  assert.equal((await req('/api/review/score',{method:'POST',token:a.token,body:{outputId:otherSession.tasks[0].answers[0].id,scores:{accuracy:2,suitability:2,utility:2}}})).status,403);
  const secondRun=await finished(second.id);assert.equal(secondRun.progress.judged,27,'人员分配不能阻断 Qwen 独立机评');
  await req('/api/admin/runs/'+second.id+'/reviewers',{method:'PUT',body:{personIds:[]}});
  assert.equal((await req('/api/review/session',{token:other.token})).status,401);
  assert.equal((await req('/api/admin/runs/'+second.id)).data.progress.judged,27);
  assert.ok(!(JSON.stringify(run).includes('test-only-secret')));assert.equal((await req('/api/admin/runs/'+id,{method:'DELETE'})).status,200);assert.equal((await req('/api/review/session',{token:a.token})).status,401);
 }finally{await stop();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));rmSync(dir,{recursive:true,force:true});}
});
