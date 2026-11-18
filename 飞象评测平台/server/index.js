import {authRequired,requireAdmin,adminAuthenticated,loginAdmin,logoutAdmin,checkLoginRate,checkReviewCode,issueReviewCode} from './auth.js';
import http from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {personnelList,savePerson,assignPeople,ensureAssignments,reviewerProgress,reviewerCaseIds,validName} from './reviewing.js';
import {db,parse,json,uid,now,getKV,putKV,getModels,safeModel,getRun,getOutputs,getReviews,getReviewers,transaction,recoverInterrupted} from './store.js';
import {assert,validateCases,validateDimensions,parseCSV,calculateReport} from './domain.js';
import {callModel,cleanError} from './providers.js';
import {launch,activeRuns} from './harness.js';
const port=Number(process.env.PORT||3000),host=process.env.HOST||'0.0.0.0';
const publicDir=resolve('public');
function send(res,status,data,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(type.startsWith('application/json')?json(data):data);}
async function body(req){let data='';for await(const chunk of req){data+=chunk;assert(Buffer.byteLength(data)<4e6,'请求体过大',413);}try{return data?JSON.parse(data):{};}catch{throw Object.assign(new Error('请求必须为有效 JSON'),{status:400});}}

function reviewer(req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const r=db.prepare('SELECT r.*,p.name FROM reviewers r JOIN personnel p ON p.id=r.personId WHERE r.token=? AND r.active=1').get(token);assert(r,'请先输入姓名进入评测',401);return r;}
function anonymize(content,run){let text=content;const names=[...run.snapshot.models.flatMap(m=>[m.name,m.model,m.provider]),'通义千问','Qwen','豆包','Doubao','DeepSeek','智谱','GLM','阿里云'].filter(s=>s&&s.length>1).sort((a,b)=>b.length-a.length);for(const name of names)text=text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'[匿名模型]');return text;}
function runDetail(run){const outputs=getOutputs(run.id),reviews=getReviews(run.id),allReviewers=reviewerProgress(run,outputs,reviews),reviewers=allReviewers.filter(r=>r.active);const report=calculateReport(run,outputs,reviews.filter(x=>reviewers.some(r=>r.id===x.reviewerId)),reviewers);const completed=report.complete&&run.status!=='running';return {...run,status:completed?'completed':run.status,outputs,reviews,reviewers,allReviewers,rubrics:db.prepare('SELECT * FROM rubrics WHERE runId=? ORDER BY caseId').all(run.id).map(r=>({...r,draft:parse(r.draft),rubric:parse(r.rubric),meta:parse(r.meta)})),report,progress:{generated:outputs.filter(o=>o.generationStatus==='done').length,judged:outputs.filter(o=>o.judgeStatus==='done').length,human:report.rows.filter(o=>o.fullReviews).length,total:outputs.length},active:activeRuns.has(run.id)};}
function validateModel(m){assert(typeof m.name==='string'&&m.name.trim(),'请输入模型名称');assert(typeof m.model==='string','model ID 格式不正确');assert(['openai','responses','gemini'].includes(m.protocol),'接口协议不支持');let u;try{u=new URL(m.baseUrl);}catch{throw new Error('请输入有效的 API 地址');}assert(u.protocol==='https:'||(['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.protocol==='http:'),'API 地址必须使用 HTTPS（本机测试服务可用 HTTP）');assert(!u.search&&!u.hash&&!u.username&&!u.password,'API 地址不能含密钥、查询参数或凭据');assert(Number.isFinite(m.temperature)&&m.temperature>=0&&m.temperature<=2,'温度须在 0—2 之间');assert(Number.isInteger(m.maxTokens)&&m.maxTokens>=256&&m.maxTokens<=65536,'输出上限须为 256—65536 的整数');assert(Number.isInteger(m.timeoutMs)&&m.timeoutMs>=10000&&m.timeoutMs<=600000,'超时须为 10—600 秒');}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');const path=url.pathname;const method=req.method;
  if(method!=='GET'&&method!=='HEAD'){
   assert(req.headers['sec-fetch-site']!=='cross-site','不接受跨站请求',403);
   if(req.headers.origin){const origin=new URL(req.headers.origin);const expected=process.env.PUBLIC_ORIGIN?new URL(process.env.PUBLIC_ORIGIN).origin:null;assert(expected?origin.origin===expected:origin.host===req.headers.host,'请求来源不匹配',403);}
  }
  if(path.startsWith('/api/admin/'))requireAdmin(req);
  if(path==='/api/auth/config'&&method==='GET')return send(res,200,{adminLoginRequired:authRequired,reviewCodeRequired:authRequired,adminAuthenticated:adminAuthenticated(req)});
  if(path==='/api/auth/admin/login'&&method==='POST'){const b=await body(req);loginAdmin(req,res,b.password);return send(res,200,{ok:true});}
  if(path==='/api/auth/admin/logout'&&method==='POST'){logoutAdmin(req,res);return send(res,200,{ok:true});}
  if(path==='/api/health')return send(res,200,{ok:true});
  if(path==='/api/admin/state'&&method==='GET'){
   const benchmarks=db.prepare('SELECT * FROM benchmarks ORDER BY created').all().map(b=>({...b,cases:parse(b.cases)}));
   const runs=db.prepare('SELECT id FROM runs ORDER BY created DESC').all().map(({id})=>{const d=runDetail(getRun(id));return {id:d.id,name:d.name,description:d.description,created:d.created,status:d.status,progress:d.progress,active:d.active,token:d.token,modelNames:d.snapshot.models.map(m=>m.name),reviewerCount:d.reviewers.length};});
   return send(res,200,{benchmarks,models:getModels().map(safeModel),dimensions:getKV('dimensions'),runs,personnel:personnelList()});
  }
  if(path==='/api/admin/dimensions'&&method==='PUT'){const b=await body(req);putKV('dimensions',validateDimensions(b.dimensions));return send(res,200,{ok:true});}
  if(path==='/api/admin/benchmarks'&&method==='POST'){
   const b=await body(req);assert(typeof b.name==='string'&&b.name.trim(),'请输入测试集名称');const cases=validateCases(b.format==='csv'?parseCSV(b.content):b.cases);const id=uid();db.prepare('INSERT INTO benchmarks VALUES (?,?,?,?)').run(id,b.name.trim(),json(cases),now());return send(res,201,{id});
  }
  let match;
  if((match=path.match(/^\/api\/admin\/personnel\/([^/]+)\/code$/))&&method==='POST')return send(res,200,{accessCode:issueReviewCode(match[1])});
  if(path==='/api/admin/personnel'&&method==='POST'){const b=await body(req);return send(res,201,savePerson(null,b.name));}
  if((match=path.match(/^\/api\/admin\/personnel\/([^/]+)$/))&&method==='PUT'){const b=await body(req);return send(res,200,savePerson(match[1],b.name));}
  if((match=path.match(/^\/api\/admin\/runs\/([^/]+)\/reviewers$/))&&method==='PUT'){const run=getRun(match[1]);assert(run,'评测任务不存在',404);const b=await body(req);assignPeople(run,b.assignments??b.personIds);return send(res,200,runDetail(run));}

  if((match=path.match(/^\/api\/admin\/benchmarks\/([^/]+)$/))){const id=match[1];assert(db.prepare('SELECT id FROM benchmarks WHERE id=?').get(id),'测试集不存在',404);
   if(method==='DELETE'){db.prepare('DELETE FROM benchmarks WHERE id=?').run(id);return send(res,200,{ok:true});}
   if(method==='PUT'){const b=await body(req);assert(typeof b.name==='string'&&b.name.trim(),'测试集名称不能为空');db.prepare('UPDATE benchmarks SET name=?,cases=? WHERE id=?').run(b.name.trim(),json(validateCases(b.cases)),id);return send(res,200,{ok:true});}
  }
  if((match=path.match(/^\/api\/admin\/models\/([^/]+)(\/test)?$/))){const old=getModels().find(m=>m.id===match[1]);assert(old,'模型不存在',404);
   if(method==='PUT'&&!match[2]){assert(!activeRuns.size,'有评测正在执行，请在完成后修改配置',409);const b=await body(req);const m={...old};for(const key of ['name','model','baseUrl','protocol','temperature','maxTokens','timeoutMs'])if(b[key]!==undefined)m[key]=b[key];if(b.apiKey!==undefined&&b.apiKey!=='')m.apiKey=String(b.apiKey).trim();if(b.clearKey)m.apiKey='';validateModel(m);if(['model','baseUrl','protocol','apiKey','temperature','maxTokens'].some(k=>m[k]!==old[k]))delete m.connection;db.prepare('UPDATE models SET config=? WHERE id=?').run(json(m),m.id);return send(res,200,safeModel(m));}
   if(method==='POST'&&match[2]){validateModel(old);try{const r=await callModel(old,'这是 API 连通性测试。请只回答：连接成功。');const connection={ok:true,at:now(),model:old.model,baseUrl:old.baseUrl,content:r.content,latencyMs:r.latencyMs,usage:r.usage};const latest=getModels().find(m=>m.id===old.id);if(latest.apiKey===old.apiKey&&latest.model===old.model&&latest.baseUrl===old.baseUrl)db.prepare('UPDATE models SET config=? WHERE id=?').run(json({...latest,connection}),old.id);return send(res,200,connection);}catch(e){const latest=getModels().find(m=>m.id===old.id);if(latest.apiKey===old.apiKey&&latest.model===old.model&&latest.baseUrl===old.baseUrl)db.prepare('UPDATE models SET config=? WHERE id=?').run(json({...latest,connection:{ok:false,at:now(),model:old.model,baseUrl:old.baseUrl,error:cleanError(e,[old.apiKey])}}),old.id);throw e;}}
  }
  if(path==='/api/admin/runs'&&method==='POST'){
   const b=await body(req);assert(typeof b.name==='string'&&b.name.trim(),'请输入任务名称');assert(activeRuns.size<1,'Demo 同时执行一个批次，以控制 API 并发与成本',409);
   const bench=db.prepare('SELECT * FROM benchmarks WHERE id=?').get(b.benchmarkId);assert(bench,'请选择有效的 Benchmark');
   const models=getModels().filter(m=>m.role==='tested');const judge=getModels().find(m=>m.role==='judge');for(const m of [...models,judge]){validateModel(m);assert(m.apiKey&&m.model,`${m.name} 尚未配置 API 密钥或 model ID`);}
   assert(models.length===3,'首期需配置三个被测模型');const id=uid(),cases=parse(bench.cases);const snapshot={benchmarkId:bench.id,benchmarkName:bench.name,cases,models:models.map(safeModel),judge:safeModel(judge),dimensions:getKV('dimensions')};
   transaction(()=>{db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?)').run(id,b.name.trim(),String(b.description||''),uid(),now(),'ready',json(snapshot));for(const c of cases){db.prepare("INSERT INTO rubrics(runId,caseId,status) VALUES (?,?,'pending')").run(id,c.id);for(const m of models)db.prepare("INSERT INTO outputs(id,runId,caseId,modelId,generationStatus,judgeStatus) VALUES (?,?,?,?,'pending','pending')").run(uid(),id,c.id,m.id);}});
   launch(id);return send(res,201,{id});
  }
  if((match=path.match(/^\/api\/admin\/runs\/([^/]+)(\/(retry|export))?$/))){const id=match[1];const run=getRun(id);assert(run,'评测任务不存在',404);
   if(method==='GET')return send(res,200,runDetail(run));
   if(method==='POST'&&match[3]==='retry'){assert(activeRuns.size===0,'请等待当前批次执行完毕',409);const b=await body(req);launch(id,{timeoutMs:b.timeoutMs,maxTokens:b.maxTokens});return send(res,200,{ok:true});}
   if(method==='DELETE'&&!match[3]){assert(!activeRuns.has(id),'运行中的任务不能删除',409);db.prepare('DELETE FROM runs WHERE id=?').run(id);return send(res,200,{ok:true});}
  }
  // No public batch inventory. A name can join only an explicitly assigned batch.
  if(path==='/api/review/join'&&method==='POST'){
   const b=await body(req),name=validName(b.name),reset=authRequired?checkLoginRate(req,'review'):()=>{};const person=db.prepare('SELECT * FROM personnel WHERE name=?').get(name);const sessionPerson=db.prepare('SELECT personId FROM reviewers WHERE token=? AND active=1').get((req.headers.authorization||'').replace(/^Bearer /,''));assert(person&&(!authRequired||sessionPerson?.personId===person.id||checkReviewCode(person.id,b.accessCode)),authRequired?'姓名或个人评测码不正确':'该姓名尚未分配评测任务，请联系管理员',403);reset();
   const projects=db.prepare('SELECT runs.id,runs.name,runs.token FROM runs JOIN reviewers r ON r.runId=runs.id WHERE r.personId=? AND r.active=1 ORDER BY runs.created DESC').all(person.id);
   const project=b.runToken?projects.find(p=>p.token===b.runToken):projects[0];assert(project,'该姓名尚未分配此评测任务，请联系管理员',403);
   const r=db.prepare('SELECT * FROM reviewers WHERE runId=? AND personId=? AND active=1').get(project.id,person.id);transaction(()=>ensureAssignments(r));
   return send(res,200,{token:r.token,name:person.name,runName:project.name,runToken:project.token});
  }
  if(path==='/api/review/session'&&method==='GET'){
   const r=reviewer(req),run=getRun(r.runId);transaction(()=>ensureAssignments(r));
   const scope=reviewerCaseIds(r);const outputs=getOutputs(run.id);const assigned=db.prepare('SELECT a.outputId,a.position,a.code,r.scores,r.note,r.updated FROM assignments a LEFT JOIN reviews r ON r.outputId=a.outputId AND r.reviewerId=a.reviewerId WHERE a.reviewerId=? ORDER BY a.position').all(r.id);
   const all=assigned.filter(a=>scope.includes(outputs.find(o=>o.id===a.outputId)?.caseId)).map(a=>{const o=outputs.find(o=>o.id===a.outputId);const c=run.snapshot.cases.find(c=>c.id===o.caseId);return {id:a.outputId,position:a.position,code:a.code,case:c,content:o.generationStatus==='done'?anonymize(o.content,run):'',status:o.generationStatus,scores:parse(a.scores),note:a.note||'',updated:a.updated};});
   const tasks=run.snapshot.cases.filter(c=>scope.includes(c.id)).map(c=>({case:c,answers:all.filter(a=>a.case.id===c.id)}));
   const projects=db.prepare('SELECT runs.name,runs.token FROM runs JOIN reviewers r ON r.runId=runs.id WHERE r.personId=? AND r.active=1 ORDER BY runs.created DESC').all(r.personId);
   return send(res,200,{name:r.name,runName:run.name,runToken:run.token,projects,dimensions:run.snapshot.dimensions.filter(d=>d.kind==='human'),cases:all.filter(a=>a.status==='done'),tasks,totalExpected:all.length,running:activeRuns.has(run.id)});
  }
  if(path==='/api/review/score'&&method==='POST'){
   const b=await body(req),r=reviewer(req);assert(db.prepare('SELECT a.outputId FROM assignments a JOIN outputs o ON o.id=a.outputId JOIN reviewer_cases c ON c.reviewerId=a.reviewerId AND c.caseId=o.caseId WHERE a.reviewerId=? AND a.outputId=?').get(r.id,b.outputId),'该 Case 未分配给当前评审',403);
   assert(db.prepare("SELECT id FROM outputs WHERE id=? AND generationStatus='done'").get(b.outputId),'该回答尚未成功生成，不能提交评分',409);
   assert(b.scores&&['accuracy','suitability','utility'].every(k=>Number.isInteger(b.scores[k])&&b.scores[k]>=1&&b.scores[k]<=3),'请完成三个维度的 1—3 分评分');
   const scores=Object.fromEntries(['accuracy','suitability','utility'].map(k=>[k,b.scores[k]]));const note=String(b.note||'');assert(note.length<=5000,'评审意见最多 5000 字');
   const updated=now();db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?) ON CONFLICT(reviewerId,outputId) DO UPDATE SET scores=excluded.scores,note=excluded.note,updated=excluded.updated').run(r.id,b.outputId,json(scores),note,updated);return send(res,200,{ok:true,updated});
  }
  if(path.startsWith('/api/'))return send(res,404,{error:'接口不存在'});
  if(method!=='GET')return send(res,405,{error:'请求方式不支持'});
  const assets={'/app.js':'app.js','/styles.css':'styles.css'};const file=assets[path]?resolve(publicDir,assets[path]):resolve(publicDir,'index.html');
  const mime={'.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'}[extname(file)];
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return send(res,200,readFileSync(file),mime);
 }catch(e){if(!res.headersSent)send(res,e.status||500,{error:cleanError(e,getModels().map(m=>m.apiKey))});else res.end();}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被占用。如已启动 EduBench，请直接打开 http://localhost:${port}/admin。`:e.message);process.exitCode=1;});
server.listen(port,host,()=>{recoverInterrupted();const actualPort=server.address().port;console.log(`EduBench 已启动：http://localhost:${actualPort}\n管理端：http://localhost:${actualPort}/admin\n评测端：http://localhost:${actualPort}/review\n数据库：data/edubench.sqlite`);});
