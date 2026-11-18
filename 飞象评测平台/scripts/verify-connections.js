// Real, minimal generation requests. Results are persisted without credentials.
import {getModels,db,json,now} from '../server/store.js';
import {callModel,cleanError} from '../server/providers.js';
await Promise.all(getModels().filter(m=>m.role==='judge'||m.id==='doubao'||(m.id==='glm'&&m.model==='glm-5.3')).map(async m=>{
 let connection;try{const r=await callModel(m,'这是教育评测平台的真实 API 连通性测试，请仅回答：连接成功。');connection={ok:true,at:now(),model:m.model,baseUrl:m.baseUrl,content:r.content,latencyMs:r.latencyMs,usage:r.usage};}catch(e){connection={ok:false,at:now(),model:m.model,baseUrl:m.baseUrl,error:cleanError(e,[m.apiKey])};}
 db.prepare('UPDATE models SET config=? WHERE id=?').run(json({...m,connection}),m.id);console.log(JSON.stringify({name:m.name,...connection}));
}));
