import {hashSecret,verifySecret} from './secrets.js';
import {randomBytes,createHash} from 'node:crypto';
import {db,now,uid,transaction} from './store.js';
import {assert} from './domain.js';

export const authRequired=process.env.NODE_ENV==='production'||process.env.AUTH_REQUIRED==='true';
const adminHash=process.env.ADMIN_PASSWORD_HASH||'';
const secureCookie=process.env.NODE_ENV==='production';
const sessionMs=12*60*60*1000;
db.exec(`CREATE TABLE IF NOT EXISTS personnel_credentials(personId TEXT PRIMARY KEY REFERENCES personnel(id) ON DELETE CASCADE,passwordHash TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions(tokenHash TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);

if(authRequired&&!/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(adminHash))throw new Error('公网模式必须配置有效的 ADMIN_PASSWORD_HASH，请运行部署凭据准备脚本。');
const digest=s=>createHash('sha256').update(s).digest('hex');
function sessionToken(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('edubench_admin='))?.slice('edubench_admin='.length)||'';}
function cookie(value,maxAge){return `edubench_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie?'; Secure':''}`;}
const attempts=new Map();
export function checkLoginRate(req,kind){const key=kind+':'+req.socket.remoteAddress;let entry=attempts.get(key);if(!entry||entry.until<Date.now()){entry={count:0,until:Date.now()+15*60*1000};if(attempts.size>=1000)attempts.delete(attempts.keys().next().value);attempts.set(key,entry);}assert(++entry.count<=30,'尝试次数过多，请在 15 分钟后重试',429);return ()=>attempts.delete(key);}
export function adminAuthenticated(req){if(!authRequired)return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);const token=sessionToken(req);if(!/^[a-f0-9]{64}$/.test(token))return false;const row=db.prepare('SELECT expires FROM admin_sessions WHERE tokenHash=?').get(digest(token));return Boolean(row&&row.expires>Date.now());}
export function requireAdmin(req){assert(adminAuthenticated(req),authRequired?'请先登录管理端':'管理端仅允许在本机访问；评审人员请使用评测链接。',authRequired?401:403);}
export function loginAdmin(req,res,password){const reset=checkLoginRate(req,'admin');assert(authRequired&&verifySecret(password,adminHash),'管理员密码不正确',401);reset();const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM admin_sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO admin_sessions VALUES (?,?)').run(digest(token),Date.now()+sessionMs);res.setHeader('Set-Cookie',cookie(token,sessionMs/1000));}
export function logoutAdmin(req,res){db.prepare('DELETE FROM admin_sessions WHERE tokenHash=?').run(digest(sessionToken(req)));res.setHeader('Set-Cookie',cookie('',0));}
export function issueReviewCode(personId){assert(db.prepare('SELECT id FROM personnel WHERE id=?').get(personId),'评测人员不存在',404);const accessCode=randomBytes(9).toString('base64url');transaction(()=>{db.prepare('INSERT INTO personnel_credentials VALUES (?,?,?) ON CONFLICT(personId) DO UPDATE SET passwordHash=excluded.passwordHash,updated=excluded.updated').run(personId,hashSecret(accessCode),now());for(const r of db.prepare('SELECT id FROM reviewers WHERE personId=?').all(personId))db.prepare('UPDATE reviewers SET token=? WHERE id=?').run(uid(),r.id);});return accessCode;}
export function checkReviewCode(personId,code){const stored=db.prepare('SELECT passwordHash FROM personnel_credentials WHERE personId=?').get(personId);return Boolean(stored&&verifySecret(code,stored.passwordHash));}
