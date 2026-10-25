import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalDigest } from '../src/delivery-art/canonical-json.js';
import { createOperatorDraftEditor } from '../src/source-authoring/operator-drafts.js';

function fixture() {
  const session = { session_id: 'session:source', caller_id: 'console', operator: { id: 'operator:example' },
    landing_unit: { base_commit: 'a'.repeat(40) }, created_at: '2026-10-25T00:00:00Z' };
  let record = { attempts: [], revision: session.created_at }, checks = 0, writes = 0, deny = false;
  const artifacts = new Map();
  const error = (code, message, options) => Object.assign(new Error(message), { code, ...options });
  const project = value => ({ session_id: session.session_id, revision: value.revision, attempt: structuredClone(value.attempts.at(-1)), replayed: false });
  const dependencies = { enabled: true, sessionFor: () => session,
    assertIdentity(s, caller, actor) { if (caller !== s.caller_id || actor !== s.operator.id) throw error('identity_forbidden','wrong owner'); },
    readRecord: () => structuredClone(record), writeRecord: (_s, value) => { record = structuredClone(value); writes++; },
    withLock: (_s, action) => action(),
    putArtifact(_s, name, value) { artifacts.set(name, structuredClone(value)); return name; },
    readArtifact: (_s, name) => structuredClone(artifacts.get(name)),
    validateDraft(_s, change) { checks++; if (deny) throw error('owner_denied','owner preflight denied'); assert.equal(change.base_commit, session.landing_unit.base_commit); },
    project, nextRevision: value => new Date(Date.parse(value.revision)+1).toISOString(), clock: () => new Date('2026-10-25T02:00:00Z'), error };
  const args = { callerId: 'console', operatorId: 'operator:example', subjectRef: 'actual-owner' };
  const request = (id='save:1') => ({ schema_version: 1, command_id: id, execution_id: 'execution:1',
    expected_revision: record.revision, expected_change_set_digest: record.attempts.at(-1)?.state === 'draft-ready' ? record.attempts.at(-1).change_set_digest : null,
    requested_at: '2026-10-25T01:00:00Z', objective: 'Author the actual small example application.', input_origin: 'manual', retry_of: null,
    commit_message: 'feat: edit real application source', operations: [{ action: 'create', path: 'app/main.js', content: '\uFEFFconst title = "你好";\r\n', expected_digest: null }] });
  return { args, session, artifacts, request, dependencies, save: createOperatorDraftEditor(dependencies),
    get record() { return record; }, set record(value) { record = value; }, get writes() { return writes; }, get checks() { return checks; }, set deny(value) { deny = value; } };
}

test('manual/import saves retain exact text without model/Git callbacks; cold replay returns the original acknowledgement', async () => {
  const f=fixture(), first=f.request(); const saved=await f.save({...f.args,request:first});
  assert.equal(saved.attempt.model,null); assert.equal(saved.attempt.context,null); assert.equal(saved.attempt.change_set.operations[0].content,first.operations[0].content);
  assert.equal(saved.attempt.operator_draft.origin,'operator'); assert.equal(f.checks,1);
  const second=f.request('save:2');second.input_origin='import';second.operations[0].content='changed\r\n';
  const amended=await f.save({...f.args,request:second});assert.notEqual(amended.attempt.change_set_digest,saved.attempt.change_set_digest);
  const cold=createOperatorDraftEditor({...f.dependencies,enabled:false});f.deny=true;
  const replay=await cold({...f.args,request:first});assert.deepEqual(replay,{...saved,replayed:true});assert.equal(f.writes,2);assert.equal(f.checks,2);
  assert.equal(f.artifacts.get(amended.attempt.operator_draft.previous_draft_ref).change_set.operations[0].content,first.operations[0].content);
  await assert.rejects(cold({...f.args,request:{...first,commit_message:'feat: altered immutable input'}}),{code:'replay_conflict'});
});

test('AI amendments preserve the original proposal and stop its model receipt from attesting edited bytes',async()=>{
  const f=fixture();await f.save({...f.args,request:f.request()});
  const model={profile_id:'source-realization-v1',audit_ref:'audit:original'};f.record.attempts[0].model=model;
  const before=structuredClone(f.record.attempts[0]),input=f.request('amend:ai');input.operations[0].content='operator edit\n';
  const after=await f.save({...f.args,request:input});assert.equal(after.attempt.model,null);assert.deepEqual(after.attempt.operator_draft.original_model,model);
  assert.equal(after.attempt.operator_draft.origin,'operator-amended-model');assert.deepEqual(f.artifacts.get(after.attempt.operator_draft.previous_draft_ref),before);
});

test('identity, stale revision/digest, scope, execution and timeline fail before retaining a draft',async()=>{
  const f=fixture(),input=f.request();
  await assert.rejects(f.save({...f.args,operatorId:'operator:other',request:input}),{code:'identity_forbidden'});
  await assert.rejects(f.save({...f.args,request:{...input,expected_revision:'2026-10-24T00:00:00Z'}}),{code:'revision_stale'});
  await assert.rejects(f.save({...f.args,request:{...input,requested_at:'2026-10-24T00:00:00Z'}}),{code:'timeline_invalid'});
  f.deny=true;await assert.rejects(f.save({...f.args,request:input}),{code:'owner_denied'});assert.equal(f.writes,0);assert.equal(f.artifacts.size,0);
  f.deny=false;await f.save({...f.args,request:input});const edit=f.request('save:2');
  await assert.rejects(f.save({...f.args,request:{...edit,expected_change_set_digest:canonicalDigest('wrong')}}),{code:'revision_stale'});
  await assert.rejects(f.save({...f.args,request:{...edit,execution_id:'execution:other'}}),{code:'execution_changed'});
  await assert.rejects(f.save({...f.args,request:{...edit,objective:'A different objective requires a new attempt.'}}),{code:'objective_changed'});
  assert.equal(f.writes,1);
});

test('uncertain source effects and trusted preparations remain immutable; terminal retries bind the actual predecessor',async()=>{
  for(const state of ['accepted','applying','apply-unknown','source-created']){
    const f=fixture();await f.save({...f.args,request:f.request()});f.record.attempts[0].state=state;
    await assert.rejects(f.save({...f.args,request:f.request('save:2')}),{code:'draft_not_editable'});assert.equal(f.writes,1);
  }
  const f=fixture();await f.save({...f.args,request:f.request()});f.record.attempts[0].state='cancelled';
  await assert.rejects(f.save({...f.args,request:f.request('save:2')}),{code:'retry_binding_invalid'});
  const next=f.request('save:2');next.retry_of='save:1';await f.save({...f.args,request:next});assert.equal(f.record.attempts.length,2);
  const guarded=createOperatorDraftEditor({...f.dependencies,assertEditable(){throw Object.assign(new Error('trusted owner'),{code:'owner_read_only'});}});
  await assert.rejects(guarded({...f.args,request:f.request('save:3')}),{code:'owner_read_only'});
});

test('invalid text, operation forms, duplicate paths, oversized content and unknown authority fields are rejected before owner calls',async()=>{
  const f=fixture(),base=f.request();
  const inputs=[{...base,repository:'other/repo'},{...base,operations:[...base.operations,...base.operations]},
    {...base,operations:[{...base.operations[0],content:'\ud800'}]}, {...base,operations:[{...base.operations[0],content:'binary\0bytes'}]},
    {...base,operations:[{...base.operations[0],content:'é'.repeat(32769)}]}, {...base,operations:[{...base.operations[0],path:'../escape'}]},
    {...base,operations:[{...base.operations[0],action:'delete'}]}, {...base,operations:Array.from({length:9},(_,i)=>({...base.operations[0],path:`app/file${i}.js`,content:'a'.repeat(65536)}))}];
  for(const request of inputs)await assert.rejects(f.save({...f.args,request}),{code:'draft_invalid'});
  assert.equal(f.checks,0);assert.equal(f.writes,0);
});

test('missing or modified retained acknowledgement never turns an unknown save into success',async()=>{
  const f=fixture(),input=f.request();await f.save({...f.args,request:input});const reference=f.record.operator_saves[0].ack_ref;
  const original=f.artifacts.get(reference);f.artifacts.delete(reference);
  await assert.rejects(f.save({...f.args,request:input}),{code:'acknowledgement_invalid',statusCode:503});
  f.artifacts.set(reference,{...original,revision:'2099-01-01T00:00:00Z'});
  await assert.rejects(f.save({...f.args,request:input}),{code:'acknowledgement_invalid',statusCode:503});assert.equal(f.writes,1);
});
