import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenProjectClient} from '../src/openproject-client.js';
const config={baseUrl:'http://backend.invalid',apiToken:'test-only',projectIdentifier:'workspace-proposals',ideaTypeId:21,customFieldSourceSurfaceId:1,customFieldSourceReferenceId:2};
function clientFor({project=7,type=21}={}){const calls=[];const client=createOpenProjectClient({config,fetchImpl:async url=>{calls.push(new URL(url).pathname);return Response.json(new URL(url).pathname.includes('/projects/')?{id:7,identifier:'workspace-proposals'}:{id:851,lockVersion:1,subject:'Scoped idea',customField1:'governance-operations-console',customField2:JSON.stringify({surface:'governance-operations-console',integration_id:'governance-operations-console',context_ref:{request_id:'test-capture'},native_ref:{command:'proposal-capture',request_id:'test-capture'}}),_links:{project:{href:`/api/v3/projects/${project}`},type:{href:`/api/v3/types/${type}`},status:{title:'captured'}}});}});return {client,calls};}
for(const invalid of [{project:8},{type:22}])test(`direct Proposal reads reject a foreign project/type ${JSON.stringify(invalid)}`,async()=>{
 const {client}=clientFor(invalid);await assert.rejects(client.getIdea(851),error=>error.statusCode===404 && error.details==='proposal_source_scope_mismatch');
});
test('direct Proposal read reuses verified backlog identity and leaves canonical data unchanged',async()=>{
 const {client,calls}=clientFor();assert.equal((await client.getIdea(851)).ideaId,'idea-851');assert.equal((await client.getIdea(851)).ideaId,'idea-851');assert.equal(calls.filter(path=>path==='/api/v3/projects/workspace-proposals').length,1);
});

for(const method of ['getSnapshot','getProjection','getEvent'])test(`${method} checks source ownership before opening an activity journal`,async()=>{
 const {createProposalWorkflowService}=await import('../src/proposal-workflow/service.js');let journalReads=0;
 const service=createProposalWorkflowService({openProjectClient:{getIdea:async()=>{throw Object.assign(new Error('Not in backlog'),{statusCode:404});},listProposalActivities:async()=>{journalReads++;return {items:[],total:0,pageSize:100};}}});
 await assert.rejects(service[method]({proposalId:'idea-851',eventId:'event:851'}),error=>error.statusCode===404);assert.equal(journalReads,0);
});
