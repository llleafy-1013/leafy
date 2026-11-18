// Creates a private migration copy. Never alters the source database or sends model requests.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {hashSecret} from '../server/secrets.js';
const sourcePath=resolve(process.env.DATA_DIR||'data','edubench.sqlite');
const targetDir=resolve('data','cloud-migration-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(targetDir,{recursive:true,mode:0o700});
const targetPath=resolve(targetDir,'edubench.sqlite');const source=new DatabaseSync(sourcePath,{readOnly:true});
await backup(source,targetPath);source.close();chmodSync(targetPath,0o600);const db=new DatabaseSync(targetPath);
db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS personnel_credentials(personId TEXT PRIMARY KEY REFERENCES personnel(id) ON DELETE CASCADE,passwordHash TEXT NOT NULL,updated TEXT NOT NULL); CREATE TABLE IF NOT EXISTS admin_sessions(tokenHash TEXT PRIMARY KEY,expires INTEGER NOT NULL); DELETE FROM admin_sessions;`);
for(const row of db.prepare('SELECT id,config FROM models').all()){const config=JSON.parse(row.config);config.apiKey='';delete config.connection;db.prepare('UPDATE models SET config=? WHERE id=?').run(JSON.stringify(config),row.id);}
const credentials=[];for(const p of db.prepare('SELECT id,name FROM personnel ORDER BY name').all()){const accessCode=randomBytes(9).toString('base64url');db.prepare('INSERT INTO personnel_credentials VALUES (?,?,?) ON CONFLICT(personId) DO UPDATE SET passwordHash=excluded.passwordHash,updated=excluded.updated').run(p.id,hashSecret(accessCode),new Date().toISOString());for(const r of db.prepare('SELECT id FROM reviewers WHERE personId=?').all(p.id))db.prepare('UPDATE reviewers SET token=? WHERE id=?').run(randomUUID(),r.id);credentials.push({name:p.name,accessCode});}
const adminPassword=randomBytes(24).toString('base64url');
writeFileSync(resolve(targetDir,'deployment.env'),`NODE_ENV=production\nDATA_DIR=/data\nADMIN_PASSWORD_HASH=${hashSecret(adminPassword)}\n`,{mode:0o600});
writeFileSync(resolve(targetDir,'credentials.json'),JSON.stringify({adminPassword,reviewers:credentials},null,2),{mode:0o600});
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();
console.log('迁移副本已准备：'+targetDir+'\n模型密钥已移除；管理员密码、个人评测码单独保存在该目录的 credentials.json（不提交 Git）。');
