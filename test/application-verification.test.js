import assert from 'node:assert/strict';
import test from 'node:test';
import {applicationVerificationState,sourceControlEvidenceProfile,applicationEvidenceKinds} from '../src/delivery-art/application-verification.js';
import {validateDeliveryArtEvidenceProfile,validateDeliveryArtEvidenceProfileCoverage} from '../src/delivery-art/review-evidence-acquisition.js';
const owner='example-source';
const appTest={id:'app-tests',kind:'tests',name:'Actual project behavior tests',executable:'node',args:['test/app.mjs'],fidelity:'pure-unit',conformance_binding:'none',timeout_seconds:60,scope:'application'};
const manual={id:'add-item',action:'Add an item in the preview',expected_result:'The new item appears in the list'};
test('early source profiles contain genuine validation commands and explicitly no application acceptance',()=>{
 const p=validateDeliveryArtEvidenceProfile(sourceControlEvidenceProfile(owner),owner);
 assert.equal(applicationVerificationState(p).mode,'unconfigured');
 assert.equal(applicationVerificationState(p).configured,false);assert.equal(applicationVerificationState(p).passed,false);
 assert.ok(p.commands.every(c=>c.kind==='validations'&&c.scope==='source-controls'));
 assert.deepEqual(applicationEvidenceKinds(p),['validations']);
 assert.deepEqual(applicationEvidenceKinds(p,'operating-ready'),['tests','validations']);
});
test('manual and automated plans are different from completed results',()=>{
 for(const mode of ['manual','automated','mixed']){
  const p=sourceControlEvidenceProfile(owner);p.application_verification={mode,manual_checks:mode==='automated'?[]:[manual]};
  if(mode!=='manual')p.commands.push(appTest);
  const state=applicationVerificationState(validateDeliveryArtEvidenceProfile(p,owner));
  assert.equal(state.mode,mode);assert.equal(state.configured,true);assert.equal(state.passed,false);
 }
});
test('contradictory plans and fabricated source-control test results fail closed',()=>{
 const invalid=[];
 let p=sourceControlEvidenceProfile(owner);p.commands.push(appTest);invalid.push(p);
 p=sourceControlEvidenceProfile(owner);p.application_verification.mode='manual';invalid.push(p);
 p=sourceControlEvidenceProfile(owner);p.application_verification.mode='automated';invalid.push(p);
 p=sourceControlEvidenceProfile(owner);p.commands[0].kind='tests';invalid.push(p);
 p=sourceControlEvidenceProfile(owner);p.application_verification={mode:'manual',manual_checks:[manual,{...manual,action:'Different action'}]};invalid.push(p);
 for(const value of invalid)assert.throws(()=>validateDeliveryArtEvidenceProfile(value,owner));
});
test('legacy profiles preserve their prior source evidence requirements',()=>{
 const p=sourceControlEvidenceProfile(owner);delete p.application_verification;p.commands.push(appTest);
 delete p.commands[0].scope;delete p.commands[1].scope;
 assert.equal(applicationVerificationState(validateDeliveryArtEvidenceProfile(p,owner)).mode,'legacy');
 assert.deepEqual(applicationEvidenceKinds(p),['tests','validations']);
});

test('source-control fidelity can never substitute for declared application conformance',()=>{
 const profile=sourceControlEvidenceProfile(owner);
 profile.commands[0].conformance_binding='matching-fidelity';
 assert.throws(()=>validateDeliveryArtEvidenceProfileCoverage({profile,ownerRepo:owner,requiredEvidenceKinds:['tests','validations'],sourceLanding:true,conformanceCases:[{id:'application-files',fidelity:'filesystem'}]}),/cover/);
});

test('an explicit test evidence obligation remains enforced outside source landing',()=>{
 const profile=sourceControlEvidenceProfile(owner);
 assert.throws(()=>validateDeliveryArtEvidenceProfileCoverage({profile,ownerRepo:owner,requiredEvidenceKinds:['tests','validations']}),/required evidence kind/);
 assert.doesNotThrow(()=>validateDeliveryArtEvidenceProfileCoverage({profile,ownerRepo:owner,sourceLanding:true,requiredEvidenceKinds:['tests','validations']}));
});
