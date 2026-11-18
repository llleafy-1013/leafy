// User-authorized one-time migration. Stop the server first. No API requests.
import {db,getRun,getOutputs,getModels,safeModel,uid,now,json,parse,putKV,getKV,transaction,recoverInterrupted} from '../server/store.js';
import {assert} from '../server/domain.js';
const sourceId=process.argv[2];assert(sourceId,'请传入来源批次 ID');assert(!getKV('flashMigration:'+sourceId),'该批次已经迁移，请勿重复执行');
recoverInterrupted();const source=getRun(sourceId);assert(source,'来源批次不存在');
const glm=getModels().find(m=>m.id==='glm');const nextModel={...glm,name:'智谱 GLM-5.3-Flash',model:'glm-5.3-flash'};delete nextModel.connection;
const newId=uid();const snapshot=structuredClone(source.snapshot);snapshot.models=snapshot.models.map(m=>m.id==='glm'?safeModel(nextModel):m);
snapshot.reusedFrom={runId:sourceId,rule:'仅复用相同 Query、相同调用配置的豆包与 DeepSeek 真实输出，以及已冻结的同一 Judge 评分标准；GLM 全部重新调用 Flash。'};
const outputs=getOutputs(sourceId);const rubrics=db.prepare('SELECT * FROM rubrics WHERE runId=?').all(sourceId);
transaction(()=>{
 db.prepare('UPDATE models SET config=? WHERE id=?').run(json(nextModel),'glm');
 db.prepare('UPDATE runs SET name=?,status=? WHERE id=?').run('GLM-5.3 诊断 · 原始真实结果','interrupted',sourceId);
 db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?)').run(newId,'基础教育首期 · GLM Flash 正式评测','依据用户选择更换为 GLM-5.3-Flash。豆包、DeepSeek 在相同配置下已成功的输出和评分复用自原始批次；详情见配置快照 reusedFrom。',uid(),now(),'ready',json(snapshot));
 for(const c of snapshot.cases){
  const r=rubrics.find(r=>r.caseId===c.id);db.prepare('INSERT INTO rubrics(runId,caseId,status,draft,rubric,meta) VALUES (?,?,?,?,?,?)').run(newId,c.id,r?.status==='done'?'done':'pending',r?.draft??null,r?.rubric??null,r?.meta??null);
  for(const m of snapshot.models){const old=outputs.find(o=>o.caseId===c.id&&o.modelId===m.id);const reuse=m.id!=='glm'&&old?.generationStatus==='done';db.prepare('INSERT INTO outputs(id,runId,caseId,modelId,generationStatus,judgeStatus,content,latencyMs,usage,autoScore,attempts,judgeMeta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(),newId,c.id,m.id,reuse?'done':'pending',reuse?old.judgeStatus==='done'?'done':'pending':'pending',reuse?old.content:null,reuse?old.latencyMs:null,reuse?json(old.usage):null,reuse&&old.autoScore?json(old.autoScore):null,reuse?old.attempts:0,reuse&&old.judgeMeta?json(old.judgeMeta):null);}
 }
 putKV('flashMigration:'+sourceId,newId);
});console.log(JSON.stringify({id:newId,reusedOutputs:outputs.filter(o=>o.modelId!=='glm'&&o.generationStatus==='done').length,newModel:nextModel.model}));
