import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPrototypeWorkflowRecords} from '../src/prototype-workflow-register.js';
const history=at=>[{at}];
test('scoped progress uses each owner namespace and never collapses retained Closure outcomes',()=>{
 const first={request:{prototype_id:'sample',request_id:'closure-1',action:'graduate-source'},history:history('2026-01-01')};
 const second={request:{prototype_id:'sample',request_id:'closure-2',action:'reopen-prototype'},history:history('2026-01-02')};
 const foreign={request:{prototype_id:'other',request_id:'closure-3'},history:history('2026-01-03')};
 assert.deepEqual(selectPrototypeWorkflowRecords([first,second,foreign],{prototypeIds:['prototype:sample'],latestOnly:false}),[first,second]);
 const landing={evaluation:{request:{prototype:{id:'prototype:sample'},request_id:'landing'}},history:history('2026-01-01')};
 assert.deepEqual(selectPrototypeWorkflowRecords([landing],{prototypeIds:['prototype:sample'],latestOnly:true}),[landing]);
 const maturity=(id,transition,at)=>({evaluation:{request:{prototype_id:'prototype:sample',request_id:id,transition}},history:history(at)});
 const older=maturity('older','candidate','2026-01-01'),newer=maturity('newer','candidate','2026-01-02'),baseline=maturity('baseline','baseline','2026-01-03');
 assert.deepEqual(selectPrototypeWorkflowRecords([newer,baseline,older],{prototypeIds:['prototype:sample'],latestOnly:true}),[newer,baseline]);
 assert.throws(()=>selectPrototypeWorkflowRecords([first],{prototypeIds:['../unsafe']}),/Invalid/);
});
