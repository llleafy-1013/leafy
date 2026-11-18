import {mkdir,copyFile,cp,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=process.cwd(),out=resolve('_site');
try{await stat(out);throw new Error('_site 已存在；请使用新的构建目录，避免覆盖。');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(out);
async function copy(source){const target=join(out,source);await mkdir(resolve(target,'..'),{recursive:true});await copyFile(join(root,source),target);}
// Explicit public allowlist. Never copy the whole repository or local-only project.
for(const file of ['index.html','.nojekyll','portfolio/index.html','portfolio/doggo/index.html','portfolio/doggo/app.js','portfolio/doggo/site.js','portfolio/doggo/styles.css','portfolio/爪爪日记/index.html','portfolio/爪爪日记/app.js','portfolio/爪爪日记/style.css'])await copy(file);
await cp(join(root,'portfolio/瑶都/html'),join(out,'portfolio/瑶都/html'),{recursive:true});
console.log('已生成静态站点：_site（不含飞象代码、配置、数据库或备份）');
