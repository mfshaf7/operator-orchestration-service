import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepositoryUseReadiness} from '../src/repository-custody/use-readiness.js';
const input={callerId:'console',correlationId:'test:repository-use',repoName:'example--project',target:'prototype'};
const binding={provider:'github',provider_repository_id:'123',full_name:'example/project'};
const current={provider_repository_id:'123',owner:'example',name:'project',visibility:'public',provider_lifecycle_state:'active'};
function gate({ready=true,proof={provider_repository:binding},lookup=current}={}){
 const calls=[];return{calls,run:createRepositoryUseReadiness({
  catalogService:{async prepareRepositoryReadiness(){calls.push('readiness');if(!ready)throw new Error('not ready');return {repository_readiness_reference:'synthetic'};}},
  inventoryService:{async repositorySourceAuthority(){calls.push('source-authority');return proof;}},
  custodyService:{async lookup(){calls.push('provider-readback');return lookup;}},
 })};
}
test('unonboarded repository blocks before any source or provider access',async()=>{const g=gate({ready:false});await assert.rejects(g.run(input));assert.deepEqual(g.calls,['readiness']);});
test('ready internal Delivery does not export metadata to Studio or read source',async()=>{const g=gate();await g.run({...input,target:'delivery'});assert.deepEqual(g.calls,['readiness']);});
test('native public Prototype requires exact current provider identity and visibility',async()=>{const g=gate();await g.run(input);assert.deepEqual(g.calls,['readiness','source-authority','provider-readback']);});
for(const change of [{visibility:'private'},{visibility:'internal'},{visibility:'unknown'},{provider_repository_id:'999'},{provider_lifecycle_state:'archived'}])test(`Prototype export denied: ${JSON.stringify(change)}`,async()=>{const g=gate({lookup:{...current,...change}});await assert.rejects(g.run(input),{code:'proposal_repository_route_unavailable'});});
test('unknown native binding cannot fall back to existing Git publication',async()=>{const g=gate({proof:{}});await assert.rejects(g.run(input),{code:'proposal_repository_route_unavailable'});});
