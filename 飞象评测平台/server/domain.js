export const dimensions = [
  {id:'fulfillment',name:'需求满足度',kind:'auto',weight:20,focus:'需求覆盖、明确约束与任务执行',levels:['未完成多项明确要求，存在明显遗漏或偏离任务。','完成大部分要求，但仍有部分要求遗漏或执行不充分。','完整响应各项明确要求，没有明显遗漏或偏离。']},
  {id:'completeness',name:'输出完整性与规范性',kind:'auto',weight:20,focus:'必要模块、结构、格式、数量与时间约束',levels:['缺少多个必要模块，或明显违反格式、数量、时间等要求。','基本满足结构要求，但存在少量内容缺失或格式、数量等问题。','必要模块齐全，格式规范，数量及时间等约束均符合要求。']},
  {id:'accuracy',name:'知识真实性与准确性',kind:'human',weight:25,focus:'学科知识、史实依据与解读准确性',levels:['存在明显错误、编造或不合理解读。','核心知识基本正确，但存在少量错误或表述不严谨。','知识准确、内容有依据，无明显错误或编造。']},
  {id:'suitability',name:'教学合理性与适配性',kind:'human',weight:20,focus:'学生认知、教学目标、逻辑与课堂时间',levels:['内容与教学目标不匹配，教学逻辑混乱或安排难以执行。','基本符合教学需求，整体流程合理，但部分内容仍需调整。','符合学生认知特点，教学目标明确，环节衔接自然且时间安排合理。']},
  {id:'utility',name:'教学实用性与创新性',kind:'human',weight:15,focus:'可操作性、学生参与与教学启发',levels:['内容空泛或资源设计缺乏可操作性，难以直接用于教学。','具备基本实用性，但仍需教师进行一定修改，创新设计较为普通。','内容具体、资源易于使用，能有效促进学生参与，并提供有价值的教学启发。']}
];
export function assert(ok,message,status=400){if(!ok){const e=new Error(message);e.status=status;throw e;}}
export function validateDimensions(ds){
 assert(Array.isArray(ds)&&ds.length===5,'必须保留五个评分维度');
 for(const d of dimensions){const x=ds.find(x=>x.id===d.id);assert(x&&x.kind===d.kind&&typeof x.name==='string'&&x.name.trim()&&Number.isFinite(x.weight)&&x.weight>0&&Array.isArray(x.levels)&&x.levels.length===3&&x.levels.every(s=>typeof s==='string'&&s.trim()),'维度配置不完整');}
 assert(Math.abs(ds.reduce((s,d)=>s+d.weight,0)-100)<0.00001,'五项权重总和必须等于 100%');return ds;
}
export function validateCases(cases){
 assert(Array.isArray(cases)&&cases.length>0&&cases.length<=200,'测试集需包含 1—200 条 Query');const ids=new Set();
 return cases.map(c=>{const out={};for(const k of ['id','title','subject','stage','category','queryType','query','background','requirements','scenario']){out[k]=String(c[k]??'').trim();}
 for(const k of ['id','title','subject','stage','category','queryType','query'])assert(out[k],`缺少 ${k} 字段`);
 assert(!ids.has(out.id),'Query ID 不能重复');assert(out.query.length<=60000,'Query 过长');ids.add(out.id);out.background ||= `${out.subject} · ${out.stage}`;out.requirements ||=out.query;return out;});
}
export function parseCSV(source){
 const rows=[];let row=[],cell='',quoted=false;
 source=source.replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 assert(!quoted,'CSV 引号未闭合');row.push(cell);if(row.some(Boolean))rows.push(row);const headers=rows.shift()||[];return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h.trim(),r[i]||''])));
}
export function validateAutoScore(v){
 assert(v&&typeof v==='object','Judge 未返回 JSON 对象');
 for(const k of ['fulfillment','completeness']){assert(v[k]&&Number.isInteger(v[k].score)&&v[k].score>=1&&v[k].score<=3&&typeof v[k].reason==='string'&&v[k].reason.trim(),'Judge 评分格式错误：必须包含两个维度的 1—3 分和理由');}
 assert(Array.isArray(v.issues)&&v.issues.every(x=>typeof x==='string'),'Judge 缺少问题列表');return v;
}
export function validateRubric(v){
 assert(v&&typeof v==='object','Judge 未返回评分标准');
 for(const k of ['fulfillment','completeness']){assert(v[k]&&Array.isArray(v[k].checks)&&v[k].checks.length>0&&v[k].checks.every(c=>typeof c==='string'&&c.trim()),'评分检查项不完整');for(const n of ['1','2','3'])assert(typeof v[k].levels?.[n]==='string'&&v[k].levels[n].trim(),'缺少 1—3 分判断依据');}
 assert(typeof v.audit==='string'&&v.audit.trim(),'缺少标准核对说明');return v;
}
export const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function calculateReport(run,outputs,reviews,reviewers=[]){
 const ds=run.snapshot.dimensions;const cases=run.snapshot.cases;
 const rows=outputs.map(o=>{const rs=reviews.filter(r=>r.outputId===o.id);const vals={};for(const d of ds)vals[d.id]=d.kind==='auto'?(o.autoScore?.[d.id]?.score??null):mean(rs.map(r=>r.scores[d.id]));
 const complete=ds.every(d=>vals[d.id]!==null);const fullReviews=reviewers.length>0&&reviewers.every(r=>rs.some(x=>x.reviewerId===r.id));
 const total=complete?ds.reduce((s,d)=>s+vals[d.id]*d.weight/3,0):null;
 return {...o,values:vals,humanCount:rs.length,fullReviews,total,disputed:ds.some(d=>d.kind==='human'&&rs.length>1&&Math.max(...rs.map(r=>r.scores[d.id]))-Math.min(...rs.map(r=>r.scores[d.id]))>=2)};});
 function aggregate(list,expected){const values=Object.fromEntries(ds.map(d=>[d.id,mean(list.map(x=>x.values[d.id]).filter(x=>x!==null))]));const complete=list.length===expected&&list.every(x=>x.total!==null&&x.fullReviews);return {values,complete,total:complete?ds.reduce((s,d)=>s+values[d.id]*d.weight/3,0):null,scored:list.filter(x=>x.total!==null).length,expected};}
 const models=run.snapshot.models.map(m=>{const list=rows.filter(x=>x.modelId===m.id);return {id:m.id,name:m.name,provider:m.provider,...aggregate(list,cases.length),autoDone:list.filter(x=>x.autoScore).length,humanDone:list.filter(x=>x.fullReviews).length,latencyMs:mean(list.filter(x=>x.latencyMs!=null).map(x=>x.latencyMs)),tokens:list.reduce((s,x)=>s+(x.usage?.total??0),0),groups:Object.fromEntries(['category','queryType','subject'].map(key=>[key,[...new Set(cases.map(c=>c[key]))].map(label=>{const ids=cases.filter(c=>c[key]===label).map(c=>c.id);return {label,...aggregate(list.filter(x=>ids.includes(x.caseId)),ids.length)};})]))};});
 const ranked=models.filter(m=>m.total!==null).sort((a,b)=>b.total-a.total);for(const m of models)m.rank=m.total===null?null:1+ranked.filter(x=>x.total>m.total+1e-8).length;
 return {models,rows,complete:models.every(m=>m.complete),dimensions:ds};
}
