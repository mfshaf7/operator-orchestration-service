import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createOperationHistoryPager} from '../src/platform-operation/history-page.js';
import {assertGovernedProductProjection} from '../src/platform-operation/governed-product-contracts.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
test('scoped history reaches release records beyond200 unrelated commands and preserves continuation after updates/new commands',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'operation-history-test-'));let reads=0;
 const record=(id,kind,day,updated=day)=>({operation_id:id,command:{subject:{kind},requested_at:`2026-01-${String(day).padStart(2,'0')}T00:00:00Z`},updated_at:`2026-01-${String(updated).padStart(2,'0')}T00:00:00Z`});
 const put=value=>writeFileSync(path.join(directory,hash(value.operation_id)+'.json'),JSON.stringify(value));
 try{
  for(let i=0;i<230;i++)put(record(`profile-${i}`,'dev-integration-profile',20));
  for(let i=1;i<=3;i++)put(record(`release-${i}`,'product-release',i));
  const page=createOperationHistoryPager({directory,read:file=>{reads++;return JSON.parse(readFileSync(file));}});
  const first=page({workspace:'governed-releases',limit:2});assert.equal(first.page.total,3);assert.deepEqual(first.records.map(r=>r.operation_id),['release-3','release-2']);assert.ok(first.page.next_cursor);
  reads=0;page({workspace:'governed-releases',limit:2});assert.equal(reads,2,'warm pages read selected canonical records only');
  put(record('release-3','product-release',3,25));put(record('release-new','product-release',24));
  const second=page({workspace:'governed-releases',limit:2,cursor:first.page.next_cursor});assert.deepEqual(second.records.map(r=>r.operation_id),['release-1']);assert.equal(second.page.next_cursor,null);
  assert.throws(()=>page({workspace:'dev-integration',cursor:first.page.next_cursor}),e=>e.statusCode===400);
  assert.throws(()=>page({workspace:'arbitrary'}),e=>e.statusCode===400);
  assert.throws(()=>page({limit:200}),e=>e.statusCode===400);
  put({bad:true,operation_id:'corrupt'});assert.throws(()=>page({workspace:'governed-releases'}),e=>e.statusCode===503);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('product projection rejects forged support, untrusted routes and extra private fields',()=>{
 const doc={schema_version:1,workflow_id:'governed-product-projection',source_version:`products:${'a'.repeat(40)}:${'b'.repeat(40)}`,observed_at:'2026-01-01T00:00:00Z',products:[{product_id:'sample',label:'Sample',maturity:'owner-managed',platform_owner:'platform-engineering',security_owner:'security-architecture',highest_real_endpoint:'owner-managed-source',stage_supported:false,production_supported:false,evidence:[],runtime:null,workflows:[],guidance_url:`https://github.com/mfshaf7/workspace-governance/blob/${'a'.repeat(40)}/contracts/products.yaml`,execution:'unsupported',unavailable_reason:'No release path.'}],page:{offset:0,limit:20,total:1,next_offset:null}};
 assert.equal(assertGovernedProductProjection(doc),doc);
 for(const posture of ['accepted-snapshot','owner-main','retained-owner-main'])assertGovernedProductProjection({...doc,source_posture:posture,source_notice:null});
 assert.throws(()=>assertGovernedProductProjection({...doc,source_posture:'current'}));
 assert.throws(()=>assertGovernedProductProjection({...doc,source_notice:{token:'private'}}));
 for(const edit of [d=>d.products[0].private_path='/private',d=>d.products[0].guidance_url='https://attacker.example/',d=>d.products[0].production_supported="yes",d=>d.products[0].workflows.push({id:'fake',label:'Fake',environment:'prod',url:'https://github.com/mfshaf7/platform-engineering/actions/workflows/manage-prod-environment.yaml'})]){const d=structuredClone(doc);edit(d);assert.throws(()=>assertGovernedProductProjection(d),e=>e.statusCode===502);}
});

test('service history enforces caller binding and delegates scoped bounded read',async()=>{
 const {createPlatformOperationService}=await import('../src/platform-operation/service.js');let captured;
 const service=createPlatformOperationService({operatorBindings:{console:'operator:synthetic'},store:{historyPage:input=>{captured=input;return {records:[],page:{workspace:input.workspace,limit:input.limit,total:0,snapshot:'sha256:'+'a'.repeat(64),next_cursor:null}};}},providerClient:{},securityDecision:{}});
 const result=await service.history({callerId:'console',workspace:'governed-releases',limit:10});assert.equal(result.operations.length,0);assert.equal(captured.workspace,'governed-releases');await assert.rejects(()=>service.history({callerId:'other'}),e=>e.statusCode===403);
});

test('product and scoped history APIs authenticate first and reject invalid query/methods',async()=>{
 const {Readable}=await import('node:stream');const {createApp}=await import('../src/app.js');const {loadConfig}=await import('../src/config.js');let calls=[];
 const app=createApp({config:loadConfig({CALLER_ALLOWED_IDS:'console',CALLER_AUTH_SECRETS_JSON:JSON.stringify({console:'synthetic-secret'})}),platformOperationService:{governedProducts:async input=>{calls.push(input);return {test:'read'};},history:async input=>{calls.push(input);return {operations:[]};}}});
 async function get(url,secret='synthetic-secret'){const req=Readable.from([]);Object.assign(req,{method:'GET',url,headers:{'x-oos-caller-id':'console','x-oos-caller-secret':secret}});let status,body;await app(req,{writeHead:code=>status=code,end:value=>body=value});return {status,body};}
 assert.equal((await get('/v1/governed-products?limit=5')).status,200);assert.equal(calls.at(-1).query.limit,'5');assert.equal((await get('/v1/governed-products','bad')).status,401);assert.equal((await get('/v1/governed-products?q=a&q=b')).status,400);assert.equal((await get('/v1/platform-operations/history?workspace=governed-releases&limit=10')).status,200);assert.equal(calls.at(-1).workspace,'governed-releases');assert.equal((await get('/v1/platform-operations/history?path=/private')).status,400);
 const disabled=createApp({config:loadConfig({CALLER_ALLOWED_IDS:'console',CALLER_AUTH_SECRETS_JSON:JSON.stringify({console:'synthetic-secret'})})});const req=Readable.from([]);Object.assign(req,{method:'GET',url:'/v1/governed-products',headers:{'x-oos-caller-id':'console','x-oos-caller-secret':'synthetic-secret'}});let status;await disabled(req,{writeHead:code=>status=code,end:()=>{}});assert.equal(status,503);
});
