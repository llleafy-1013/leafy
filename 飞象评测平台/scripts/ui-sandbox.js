// Isolated UI acceptance copy: preserves real outputs, strips credentials, never calls providers.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'edubench-ui-'));
const source=new DatabaseSync(resolve('data/edubench.sqlite'),{readOnly:true});await backup(source,join(dir,'edubench.sqlite'));source.close();chmodSync(join(dir,'edubench.sqlite'),0o600);
const db=new DatabaseSync(join(dir,'edubench.sqlite'));
for(const r of db.prepare('SELECT * FROM models').all()){const m=JSON.parse(r.config);m.apiKey='';delete m.connection;db.prepare('UPDATE models SET config=? WHERE id=?').run(JSON.stringify(m),r.id);}
db.prepare("UPDATE runs SET name='[隔离验收] '||name").run();db.close();writeFileSync('/tmp/edubench-ui-check-path',dir,{mode:0o600});console.log(dir);
