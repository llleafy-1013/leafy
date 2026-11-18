import {randomInt} from 'node:crypto';
import {db,uid,now,getOutputs,getReviewers,getReviews,getRun,transaction} from './store.js';
import {assert,mean} from './domain.js';

export function validName(value){assert(typeof value==='string','请输入评测人员姓名');const name=value.normalize('NFKC').trim();assert(name.length>=1&&name.length<=40,'请输入 1—40 字的评测人员姓名');return name;}
export function personnelList(){return db.prepare('SELECT * FROM personnel ORDER BY created,id').all().map(p=>({...p,hasAccessCode:Boolean(db.prepare('SELECT personId FROM personnel_credentials WHERE personId=?').get(p.id)),assignedRuns:db.prepare('SELECT COUNT(*) AS n FROM reviewers WHERE personId=? AND active=1').get(p.id).n}));}
export function savePerson(id,value){const name=validName(value);assert(!db.prepare('SELECT id FROM personnel WHERE name=? AND id<>?').get(name,id||''),'姓名已存在，请使用唯一姓名',409);
 if(id){assert(db.prepare('SELECT id FROM personnel WHERE id=?').get(id),'评测人员不存在',404);transaction(()=>{db.prepare('UPDATE personnel SET name=?,updated=? WHERE id=?').run(name,now(),id);db.prepare('UPDATE reviewers SET name=? WHERE personId=?').run(name,id);});}
 else{id=uid();db.prepare('INSERT INTO personnel VALUES (?,?,?,?)').run(id,name,now(),now());}return {id,name};
}
function shuffle(list){for(let i=list.length-1;i>0;i--){const j=randomInt(i+1);[list[i],list[j]]=[list[j],list[i]];}return list;}
export function reviewerCaseIds(r){return db.prepare('SELECT caseId FROM reviewer_cases WHERE reviewerId=? ORDER BY caseId').all(r.id).map(x=>x.caseId);}
export function ensureAssignments(r){const scope=new Set(reviewerCaseIds(r));const existing=new Set(db.prepare('SELECT outputId FROM assignments WHERE reviewerId=?').all(r.id).map(a=>a.outputId));let pos=db.prepare('SELECT COALESCE(MAX(position),-1) AS n FROM assignments WHERE reviewerId=?').get(r.id).n+1;
 const outputs=getOutputs(r.runId);for(const c of getRun(r.runId).snapshot.cases.filter(c=>scope.has(c.id))){const fresh=shuffle(outputs.filter(o=>o.caseId===c.id&&!existing.has(o.id)));for(const o of fresh)db.prepare('INSERT INTO assignments VALUES (?,?,?,?)').run(r.id,o.id,pos++,`答案 ${uid().slice(0,8).toUpperCase()}`);}
}
export function assignPeople(run,assignments){
 assert(Array.isArray(assignments),'人员列表格式不正确');const caseIds=run.snapshot.cases.map(c=>c.id);
 // Preserve the legacy API: an array of person IDs assigns the whole batch.
 const normalized=assignments.map(a=>typeof a==='string'?{personId:a,caseIds}:a);
 assert(normalized.every(a=>a&&typeof a.personId==='string')&&new Set(normalized.map(a=>a.personId)).size===normalized.length,'人员列表格式不正确');
 const people=normalized.map(a=>{const p=db.prepare('SELECT * FROM personnel WHERE id=?').get(a.personId);assert(p,'所选评测人员不存在');assert(Array.isArray(a.caseIds)&&a.caseIds.length>0&&new Set(a.caseIds).size===a.caseIds.length&&a.caseIds.every(id=>caseIds.includes(id)),'请为每位人员选择本批次有效且不重复的 Query');return {...p,caseIds:a.caseIds};});
 transaction(()=>{db.prepare('UPDATE reviewers SET active=0 WHERE runId=?').run(run.id);for(const p of people){let r=db.prepare('SELECT * FROM reviewers WHERE runId=? AND personId=?').get(run.id,p.id);if(!r){r={id:uid(),runId:run.id,name:p.name,token:uid(),created:now(),personId:p.id};db.prepare('INSERT INTO reviewers(id,runId,name,token,created,personId,active) VALUES (?,?,?,?,?,?,1)').run(r.id,r.runId,r.name,r.token,r.created,r.personId);}else db.prepare('UPDATE reviewers SET active=1 WHERE id=?').run(r.id);
  db.prepare('DELETE FROM reviewer_cases WHERE reviewerId=?').run(r.id);for(const id of p.caseIds)db.prepare('INSERT INTO reviewer_cases VALUES (?,?)').run(r.id,id);ensureAssignments(r);
 }});
}
export function reviewerProgress(run,outputs=getOutputs(run.id),reviews=getReviews(run.id)){
 return getReviewers(run.id).map(r=>{const caseIds=reviewerCaseIds(r),scoped=outputs.filter(o=>caseIds.includes(o.caseId));const own=reviews.filter(x=>x.reviewerId===r.id&&scoped.some(o=>o.id===x.outputId));const tasks=run.snapshot.cases.filter(c=>caseIds.includes(c.id)).map(c=>{const answers=scoped.filter(o=>o.caseId===c.id).map(o=>{const review=own.find(x=>x.outputId===o.id);return {outputId:o.id,modelId:o.modelId,generationStatus:o.generationStatus,submitted:Boolean(review),updated:review?.updated??null};});return {id:c.id,title:c.title,subject:c.subject,done:answers.filter(a=>a.submitted).length,total:answers.length,answers};});return {...r,caseIds,done:own.length,total:scoped.length,taskDone:tasks.filter(t=>t.total>0&&t.done===t.total).length,taskTotal:tasks.length,tasks,lastSubmitted:own.map(x=>x.updated).sort().at(-1)??null,values:Object.fromEntries(run.snapshot.dimensions.filter(d=>d.kind==='human').map(d=>[d.id,mean(own.map(x=>x.scores[d.id]))]))};});
}
