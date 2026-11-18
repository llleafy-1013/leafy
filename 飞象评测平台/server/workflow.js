import {db,uid,now,json,parse,getKV,getModels,safeModel,getRun,getReviewers,transaction} from './store.js';
import {assert} from './domain.js';
import {reviewerCaseIds,ensureAssignments} from './reviewing.js';

function taskName(value){assert(typeof value==='string'&&value.trim()&&value.trim().length<=100,'请输入 1—100 字的任务名称');return value.trim();}
function benchmarkSnapshot(id,caseIds){
 const b=db.prepare('SELECT * FROM benchmarks WHERE id=?').get(id);assert(b,'请选择有效的 Benchmark');const all=parse(b.cases);
 const ids=caseIds??all.map(c=>c.id);assert(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>all.some(c=>c.id===id)),'请至少选择一条有效且不重复的 Query');
 return {benchmarkId:b.id,benchmarkName:b.name,cases:all.filter(c=>ids.includes(c.id))};
}
export function createDraft(body){
 const id=uid(),models=getModels();const snapshot={cases:[],models:models.filter(m=>m.role==='tested').map(safeModel),judge:safeModel(models.find(m=>m.role==='judge')),dimensions:getKV('dimensions'),...(body.benchmarkId?benchmarkSnapshot(body.benchmarkId,body.caseIds):{})};
 const name=taskName(body.name);assert(String(body.description??'').length<=5000,'任务描述最多 5000 字');
 transaction(()=>{db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?)').run(id,name,String(body.description??''),uid(),now(),'draft',json(snapshot));db.prepare('INSERT INTO run_workflows VALUES (?,?,NULL,?)').run(id,body.benchmarkId?3:2,now());});return getRun(id);
}
export function saveDraft(run,body){
 assert(!run.published,'已发布任务的配置已冻结，请创建新任务',409);const snapshot={...run.snapshot};
 if(body.benchmarkId!==undefined)Object.assign(snapshot,benchmarkSnapshot(body.benchmarkId,body.caseIds));
 const name=body.name===undefined?run.name:taskName(body.name),description=body.description===undefined?run.description:String(body.description);assert(description.length<=5000,'任务描述最多 5000 字');
 const step=body.benchmarkId!==undefined?3:body.name!==undefined?2:run.setupStep;
 transaction(()=>{
  db.prepare('UPDATE runs SET name=?,description=?,snapshot=? WHERE id=?').run(name,description,json(snapshot),run.id);
  // Keep still-valid draft assignments when the selected Benchmark changes.
  for(const r of getReviewers(run.id)){for(const id of reviewerCaseIds(r))if(!snapshot.cases.some(c=>c.id===id))db.prepare('DELETE FROM reviewer_cases WHERE reviewerId=? AND caseId=?').run(r.id,id);if(!reviewerCaseIds(r).length)db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(r.id);}
  db.prepare('UPDATE run_workflows SET step=?,updated=? WHERE runId=?').run(step,now(),run.id);
 });return getRun(run.id);
}
export function preparePublication(run,{authRequired,validateModel,activeRuns}){
 if(run.published)return false; // A repeated click must never issue another model call.
 assert(activeRuns.size===0,'请等待当前批次执行完毕后发布',409);
 assert(run.snapshot.cases.length>0,'请先配置 Benchmark');
 const reviewers=getReviewers(run.id).filter(r=>r.active);const missing=run.snapshot.cases.filter(c=>!reviewers.some(r=>reviewerCaseIds(r).includes(c.id)));
 assert(!missing.length,'以下 Query 尚未分配人员：'+missing.map(c=>c.id).join('、'));
 if(authRequired){const missingCodes=reviewers.filter(r=>!db.prepare('SELECT personId FROM personnel_credentials WHERE personId=?').get(r.personId));assert(!missingCodes.length,'请先生成个人评测码：'+missingCodes.map(r=>r.name).join('、'));}
 const models=getModels().filter(m=>m.role==='tested'),judge=getModels().find(m=>m.role==='judge');assert(models.length===3&&judge,'需要三个被测模型及一个 Judge');
 for(const m of [...models,judge]){validateModel(m);assert(m.apiKey&&m.model,`${m.name} 尚未配置 API 密钥或 model ID，请先完成模型配置`);}
 const snapshot={...run.snapshot,models:models.map(safeModel),judge:safeModel(judge),dimensions:getKV('dimensions')};
 transaction(()=>{
  db.prepare('UPDATE runs SET snapshot=?,status=? WHERE id=?').run(json(snapshot),'ready',run.id);
  for(const c of snapshot.cases){db.prepare('INSERT INTO rubrics(runId,caseId,status) VALUES (?,?,?)').run(run.id,c.id,'pending');for(const m of models)db.prepare('INSERT INTO outputs(id,runId,caseId,modelId,generationStatus,judgeStatus) VALUES (?,?,?,?,?,?)').run(uid(),run.id,c.id,m.id,'pending','pending');}
  db.prepare('UPDATE run_workflows SET step=4,publishedAt=?,updated=? WHERE runId=?').run(now(),now(),run.id);
  for(const r of reviewers)ensureAssignments({...r,runId:run.id});
 });return true;
}
