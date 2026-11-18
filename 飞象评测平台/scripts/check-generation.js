import {callModel} from '../server/providers.js';
for(const [name,prefix] of [['DeepSeek','DEEPSEEK'],['GLM','GLM']]){
 const c={apiKey:process.env[prefix+'_API_KEY'],model:process.env[prefix+'_MODEL'],baseUrl:prefix==='DEEPSEEK'?'https://api.deepseek.com/v1':'https://open.bigmodel.cn/api/paas/v4',protocol:'openai',temperature:0.3,maxTokens:1024,timeoutMs:90000};
 try{const r=await callModel(c,'这是评测平台的真实 API 连通性测试，请仅回答：连接成功。');console.log(JSON.stringify({name,model:c.model,content:r.content,usage:r.usage,latencyMs:r.latencyMs}));}catch(e){console.log(JSON.stringify({name,error:e.message}));}
}
