import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {dimensions} from './domain.js';
export const dataDir=resolve(process.env.DATA_DIR||'data');mkdirSync(dataDir,{recursive:true,mode:0o700});
export const db=new DatabaseSync(resolve(dataDir,'edubench.sqlite'));
chmodSync(resolve(dataDir,'edubench.sqlite'),0o600);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS benchmarks (id TEXT PRIMARY KEY, name TEXT NOT NULL, cases TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, config TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, token TEXT UNIQUE NOT NULL, created TEXT NOT NULL, status TEXT NOT NULL, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outputs (id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, caseId TEXT NOT NULL, modelId TEXT NOT NULL, generationStatus TEXT NOT NULL, judgeStatus TEXT NOT NULL, content TEXT, latencyMs INTEGER, usage TEXT, autoScore TEXT, error TEXT, judgeError TEXT, attempts INTEGER NOT NULL DEFAULT 0, judgeMeta TEXT, UNIQUE(runId,caseId,modelId));
CREATE TABLE IF NOT EXISTS rubrics (runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, caseId TEXT NOT NULL, status TEXT NOT NULL, draft TEXT, rubric TEXT, error TEXT, meta TEXT, PRIMARY KEY(runId,caseId));
CREATE TABLE IF NOT EXISTS reviewers (id TEXT PRIMARY KEY,runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,name TEXT NOT NULL,token TEXT UNIQUE NOT NULL,created TEXT NOT NULL, UNIQUE(runId,name));
CREATE TABLE IF NOT EXISTS assignments (reviewerId TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,outputId TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,position INTEGER NOT NULL,code TEXT NOT NULL, PRIMARY KEY(reviewerId,outputId));
CREATE TABLE IF NOT EXISTS reviews (reviewerId TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,outputId TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,scores TEXT NOT NULL,note TEXT NOT NULL,updated TEXT NOT NULL, PRIMARY KEY(reviewerId,outputId));
CREATE TABLE IF NOT EXISTS personnel (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviewer_cases (reviewerId TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,caseId TEXT NOT NULL,PRIMARY KEY(reviewerId,caseId));
CREATE TABLE IF NOT EXISTS run_workflows (runId TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,step INTEGER NOT NULL DEFAULT 2,publishedAt TEXT,updated TEXT NOT NULL);
`);
export const json=JSON.stringify,parse=s=>s?JSON.parse(s):null,uid=()=>randomUUID(),now=()=>new Date().toISOString();
export function getKV(key,fallback){const r=db.prepare('SELECT value FROM kv WHERE key=?').get(key);return r?parse(r.value):fallback;}
export function putKV(key,value){db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json(value));}
if(!getKV('initialized',false)){
 db.prepare('INSERT INTO benchmarks VALUES (?,?,?,?)').run('prd-v1','EduBench · 基础教育首期 Benchmark',readFileSync(new URL('./benchmark.json',import.meta.url),'utf8'),now());
 putKV('dimensions',dimensions);putKV('initialized',true);
}
// Migration keeps historical run snapshots intact; the new PRD uses Doubao as tested model and Qwen as Judge.
if(getKV('modelSetupVersion',0)<2){db.prepare('DELETE FROM models WHERE id IN (?,?)').run('qwen','gemini');putKV('modelSetupVersion',2);}
const defaults=[
 {id:'doubao',name:'豆包 Doubao Seed 2.1 Lite',provider:'火山引擎',role:'tested',protocol:'responses',baseUrl:process.env.DOUBAO_BASE_URL||'https://ark.cn-beijing.volces.com/api/v3',model:process.env.DOUBAO_MODEL||'',apiKey:process.env.DOUBAO_API_KEY||''},
 {id:'deepseek',name:'DeepSeek V4.1 Flash',provider:'DeepSeek',role:'tested',protocol:'openai',baseUrl:process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com/v1',model:process.env.DEEPSEEK_MODEL||'',apiKey:process.env.DEEPSEEK_API_KEY||''},
 {id:'glm',name:'智谱 GLM-5.3-Flash',provider:'智谱',role:'tested',protocol:'openai',baseUrl:process.env.GLM_BASE_URL||'https://open.bigmodel.cn/api/paas/v4',model:process.env.GLM_MODEL||'glm-5.3-flash',apiKey:process.env.GLM_API_KEY||''},
 {id:'qwen',name:'Qwen3.8-Max',provider:'阿里云',role:'judge',protocol:'openai',baseUrl:process.env.QWEN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',model:process.env.QWEN_MODEL||'qwen3.8-max',apiKey:process.env.QWEN_API_KEY||''}
];
for(const m of defaults){const existing=db.prepare('SELECT config FROM models WHERE id=?').get(m.id);if(!existing)db.prepare('INSERT INTO models VALUES (?,?)').run(m.id,json({...m,temperature:0.3,maxTokens:16384,timeoutMs:300000}));
 else {const config=parse(existing.config);const prefix={qwen:'QWEN',deepseek:'DEEPSEEK',glm:'GLM',doubao:'DOUBAO'}[m.id];for(const [field,suffix] of [['apiKey','API_KEY'],['model','MODEL'],['baseUrl','BASE_URL']])if(!config[field]&&process.env[`${prefix}_${suffix}`])config[field]=process.env[`${prefix}_${suffix}`];db.prepare('UPDATE models SET config=? WHERE id=?').run(json(config),m.id);}
}
if(getKV('modelSetupVersion',0)<3){const row=db.prepare('SELECT config FROM models WHERE id=?').get('doubao');if(row){const m=parse(row.config);m.protocol='responses';db.prepare('UPDATE models SET config=? WHERE id=?').run(json(m),m.id);}putKV('modelSetupVersion',3);}
export function getModels(){return db.prepare("SELECT config FROM models ORDER BY CASE id WHEN 'doubao' THEN 0 WHEN 'deepseek' THEN 1 WHEN 'glm' THEN 2 ELSE 3 END").all().map(r=>parse(r.config));}
export function safeModel(m){const {apiKey,...rest}=m;return {...rest,hasKey:Boolean(apiKey),ready:Boolean(apiKey&&m.model&&m.baseUrl)};}
export function getRun(id){const r=db.prepare('SELECT * FROM runs WHERE id=?').get(id);if(!r)return null;const w=db.prepare('SELECT * FROM run_workflows WHERE runId=?').get(id);return {...r,snapshot:parse(r.snapshot),published:!w||Boolean(w.publishedAt),publishedAt:w?.publishedAt??null,setupStep:w?.step??4};}
export function getOutputs(id){return db.prepare('SELECT * FROM outputs WHERE runId=? ORDER BY caseId,modelId').all(id).map(r=>({...r,usage:parse(r.usage),autoScore:parse(r.autoScore),judgeMeta:parse(r.judgeMeta)}));}
export function getReviewers(id){return db.prepare('SELECT r.id,p.name,r.personId,r.active,r.created FROM reviewers r JOIN personnel p ON p.id=r.personId WHERE runId=? ORDER BY r.created,r.id').all(id);}
export function getReviews(id){return db.prepare('SELECT r.* FROM reviews r JOIN outputs o ON o.id=r.outputId WHERE o.runId=?').all(id).map(r=>({...r,scores:parse(r.scores)}));}
export function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
// Preserve existing reviewer IDs, tokens, anonymous codes and submitted scores.
if(!getKV('personnelMigration',false))transaction(()=>{
 const cols=db.prepare('PRAGMA table_info(reviewers)').all().map(c=>c.name);
 if(!cols.includes('personId'))db.exec('ALTER TABLE reviewers ADD COLUMN personId TEXT REFERENCES personnel(id)');
 if(!cols.includes('active'))db.exec('ALTER TABLE reviewers ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
 for(const r of db.prepare('SELECT * FROM reviewers').all()){
  const name=r.name.normalize('NFKC').trim();let p=db.prepare('SELECT * FROM personnel WHERE name=?').get(name);
  if(!p){p={id:uid()};db.prepare('INSERT INTO personnel VALUES (?,?,?,?)').run(p.id,name,r.created,r.created);}
  db.prepare('UPDATE reviewers SET personId=? WHERE id=?').run(p.id,r.id);
 }
 putKV('personnelMigration',true);
});
// Existing reviewers keep access to their original full batch; new assignments specify Query IDs.
if(!getKV('reviewerCasesMigration',false))transaction(()=>{
 for(const r of db.prepare('SELECT id,runId FROM reviewers').all()){
  for(const c of getRun(r.runId).snapshot.cases)db.prepare('INSERT OR IGNORE INTO reviewer_cases VALUES (?,?)').run(r.id,c.id);
 }
 putKV('reviewerCasesMigration',true);
});
// Only the server process performs recovery, not read-only diagnostics importing this module.
export function recoverInterrupted(){db.exec(`UPDATE outputs SET generationStatus='failed',error='服务重启中断了请求；可手动重试，供应商可能已计费。' WHERE generationStatus='running';
UPDATE outputs SET judgeStatus='failed',judgeError='服务重启中断了机评；请重试。' WHERE judgeStatus='running';
UPDATE rubrics SET status='failed',error='服务重启中断了评分标准生成或核对；请重试。' WHERE status='running';
UPDATE runs SET status='interrupted' WHERE status='running';`);}
