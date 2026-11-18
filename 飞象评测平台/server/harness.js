import {db,parse,json,getRun,getModels,getOutputs,now} from './store.js';
import {callModel,draftRubric,auditRubric,judgeOutput,cleanError} from './providers.js';
import {assert} from './domain.js';
export const activeRuns=new Map();
function configFor(snapshot){const current=getModels().find(m=>m.id===snapshot.id);assert(current?.apiKey,`${snapshot.name} 缺少 API 密钥`);return {...snapshot,apiKey:current.apiKey};}
export function launch(id){assert(!activeRuns.has(id),'任务正在执行，请等待',409);const run=getRun(id);assert(run,'任务不存在',404);
 for(const m of [...run.snapshot.models,run.snapshot.judge])configFor(m);
 db.prepare("UPDATE runs SET status='running' WHERE id=?").run(id);
 const promise=execute(id).catch(e=>{console.error('Harness:',cleanError(e,getModels().map(m=>m.apiKey)));db.prepare("UPDATE runs SET status='interrupted' WHERE id=?").run(id);}).finally(()=>activeRuns.delete(id));activeRuns.set(id,promise);
}
async function execute(id){
 const run=getRun(id),judge=configFor(run.snapshot.judge);
 async function executeCase(c){
  let rubricRow=db.prepare('SELECT * FROM rubrics WHERE runId=? AND caseId=?').get(id,c.id);
  const outputs=getOutputs(id).filter(o=>o.caseId===c.id);
  // Query is identical for all tested models. Three vendors run concurrently.
  await Promise.all(outputs.filter(o=>o.generationStatus!=='done').map(async o=>{
   const config=configFor(run.snapshot.models.find(m=>m.id===o.modelId));
   db.prepare("UPDATE outputs SET generationStatus='running',error=NULL,attempts=attempts+1 WHERE id=?").run(o.id);
   try{const r=await callModel(config,c.query);db.prepare("UPDATE outputs SET generationStatus='done',content=?,latencyMs=?,usage=?,error=NULL WHERE id=?").run(r.content,r.latencyMs,json({...r.usage,finish:r.finish,request:r.request}),o.id);}
   catch(e){const p=e.partial;db.prepare("UPDATE outputs SET generationStatus='failed',content=?,latencyMs=?,usage=?,error=? WHERE id=?").run(p?.content??null,p?.latencyMs??null,p?json({...p.usage,finish:p.finish,request:p.request}):null,cleanError(e,[config.apiKey]),o.id);}
  }));
  if(rubricRow.status!=='done'){
   db.prepare("UPDATE rubrics SET status='running',error=NULL WHERE runId=? AND caseId=?").run(id,c.id);
   let draft=parse(rubricRow.draft),meta=parse(rubricRow.meta)||{};
   try{
    if(!draft){const r=await draftRubric(judge,c,run.snapshot.dimensions);draft=r.value;meta.draft={...r,value:undefined};db.prepare('UPDATE rubrics SET draft=?,meta=? WHERE runId=? AND caseId=?').run(json(draft),json(meta),id,c.id);}
    const r=await auditRubric(judge,c,run.snapshot.dimensions,draft);meta.audit={...r,value:undefined};db.prepare("UPDATE rubrics SET status='done',rubric=?,meta=?,error=NULL WHERE runId=? AND caseId=?").run(json(r.value),json(meta),id,c.id);
   }catch(e){if(e.response||e.partial)meta.failedResponse=e.response||e.partial;db.prepare("UPDATE rubrics SET status='failed',error=?,meta=? WHERE runId=? AND caseId=?").run(cleanError(e,[judge.apiKey]),json(meta),id,c.id);}
   rubricRow=db.prepare('SELECT * FROM rubrics WHERE runId=? AND caseId=?').get(id,c.id);
  }
  if(rubricRow.status==='done')await Promise.all(getOutputs(id).filter(o=>o.caseId===c.id&&o.generationStatus==='done'&&o.judgeStatus!=='done').map(async o=>{
   db.prepare("UPDATE outputs SET judgeStatus='running',judgeError=NULL WHERE id=?").run(o.id);
   try{const r=await judgeOutput(judge,c,parse(rubricRow.rubric),o.content);db.prepare("UPDATE outputs SET judgeStatus='done',autoScore=?,judgeMeta=?,judgeError=NULL WHERE id=?").run(json(r.value),json({...r,value:undefined}),o.id);}
   catch(e){db.prepare("UPDATE outputs SET judgeStatus='failed',judgeError=?,judgeMeta=? WHERE id=?").run(cleanError(e,[judge.apiKey]),json(e.response||e.partial||null),o.id);}
  }));
 }
 // Three Query pipelines at a time: no extra API calls, bounded vendor concurrency.
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,run.snapshot.cases.length)},async()=>{while(cursor<run.snapshot.cases.length){const c=run.snapshot.cases[cursor++];await executeCase(c);}}));
 const outputs=getOutputs(id);const failed=outputs.some(o=>o.generationStatus!=='done'||o.judgeStatus!=='done');
 db.prepare('UPDATE runs SET status=? WHERE id=?').run(failed?'needs_attention':'awaiting_human',id);
}
