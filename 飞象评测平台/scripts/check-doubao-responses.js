import {callModel,cleanError} from '../server/providers.js';
const config={apiKey:process.env.DOUBAO_API_KEY,model:process.env.DOUBAO_MODEL,protocol:'responses',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',temperature:.3,maxTokens:16384,timeoutMs:300000};
try{const r=await callModel(config,'这是教育评测平台的真实 API 连通性测试，请仅回答：连接成功。');console.log(JSON.stringify({ok:true,...r}));}catch(e){console.log(JSON.stringify({ok:false,error:cleanError(e,[config.apiKey])}));}
