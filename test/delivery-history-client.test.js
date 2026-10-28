import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenProjectClient} from '../src/openproject-client.js';

const config={baseUrl:'http://example.test',apiToken:'synthetic-only',deliveryProjectIdentifier:'workspace-delivery-art',deliveryTopLevelTypeId:51};
const root={id:42,lockVersion:8,subject:'Retained item',description:{raw:''},_links:{project:{href:'/api/v3/projects/7'},type:{title:'Epic',href:'/api/v3/types/51'},parent:{href:null},status:{title:'retired'}}};

test('the real unpaginated activity collection is consumed once and exposed as non-overlapping logical pages',async()=>{
 const items=Array.from({length:102},(_,index)=>({id:index+1,_type:'Activity',version:index+1,createdAt:'2026-10-28T00:00:00Z',details:[],comment:{raw:''},_links:{user:{href:'/api/v3/users/7'}}}));
 const client=createOpenProjectClient({config,requestImpl:async()=>Response.json({_type:'Collection',count:102,total:102,_embedded:{elements:items}})});
 const receipts=await client.listWorkDesignApplicationActivities({recordId:42,offset:1,pageSize:100});
 assert.equal(receipts.items.length,102);assert.equal(receipts.pageSize,102);assert.equal(receipts.total,102);
 const first=await client.listDeliveryItemActivities({recordId:42,offset:1,pageSize:25});
 const second=await client.listDeliveryItemActivities({recordId:42,offset:2,pageSize:25});
 assert.equal(first.items.length,25);assert.equal(first.items[0].id,1);assert.equal(second.items.length,25);assert.equal(second.items[0].id,26);assert.equal(second.offset,2);assert.equal(second.total,102);assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,50);
});

test('archive target proves exact project, root and type before reading optional metadata',async()=>{
 for(const change of [{id:99},{_links:{...root._links,project:{href:'/api/v3/projects/99'}}},{_links:{...root._links,type:{title:'Feature'}}},{_links:{...root._links,parent:{href:'/api/v3/work_packages/1'}}}]) {
  let formReads=0;
  const client=createOpenProjectClient({config,requestImpl:async(url)=>{
   const path=new URL(url).pathname;
   if(path==='/api/v3/projects/workspace-delivery-art')return Response.json({id:7});
   if(path==='/api/v3/work_packages/42')return Response.json({...root,...change});
   formReads++;throw Error('Must reject before form or activity access');
  }});
  assert.equal(await client.getDeliveryHistoryTarget({recordId:42}),null);assert.equal(formReads,0);
 }
});

test('missing current schema does not hide a scope-validated retired item',async()=>{
 const client=createOpenProjectClient({config,requestImpl:async(url)=>{
  const path=new URL(url).pathname;
  if(path==='/api/v3/projects/workspace-delivery-art')return Response.json({id:7});
  if(path==='/api/v3/work_packages/42')return Response.json(root);
  return Response.json({message:'Current schema unavailable'},{status:503});
 }});
 const target=await client.getDeliveryHistoryTarget({recordId:42});assert.equal(target.recordRef,'openproject://work_packages/42');assert.equal(target.status,'retired');assert.equal(target.title,'Retained item');assert.equal(target.ownerRepo,null);
});

test('item activity retains real actor, change details and backend pagination',async()=>{
 const client=createOpenProjectClient({config,requestImpl:async(url)=>{
  const parsed=new URL(url);assert.equal(parsed.pathname,'/api/v3/work_packages/42/activities');assert.equal(parsed.searchParams.get('offset'),'2');assert.equal(parsed.searchParams.get('pageSize'),'25');
  return Response.json({count:1,total:26,offset:2,pageSize:25,_embedded:{elements:[{id:88,_type:'Activity',version:2,createdAt:'2026-10-28T00:00:00Z',details:[{html:'Status changed from new to done'}],comment:{raw:''},_links:{user:{href:'/api/v3/users/7',title:'Original author'}}}]}});
 }});
 const page=await client.listDeliveryItemActivities({recordId:42,offset:2,pageSize:25});assert.equal(page.total,26);assert.equal(page.offset,2);assert.equal(page.items[0].userName,'Original author');assert.deepEqual(page.items[0].details,['Status changed from new to done']);assert.equal(page.items[0].type,'Activity');
});
