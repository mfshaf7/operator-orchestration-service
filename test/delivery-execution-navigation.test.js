import test from "node:test";
import assert from "node:assert/strict";
import { deliveryExecutionNavigation } from "../src/delivery-execution-navigation.js";
import { createDeliveryService } from "../src/delivery-service.js";

const node = (id, type, status, children = [], extra = {}) => ({ id, type, status, children, ...extra });
const root = (...children) => node(1, "Epic", "new", children);
test("preparation routes native New work without changing statuses or granting admission", () => {
  const tree = root(node(2,"Feature","new",[node(3,"User story","new",[],{ready_contract_satisfied:true}),node(4,"Task","new")]));
  const original = structuredClone(tree), result = deliveryExecutionNavigation(tree);
  assert.equal(result.workflow_phase,"execution"); assert.equal(result.package_posture,"Ready");
  assert.deepEqual(result.prepared_work_item_ids,[3]); assert.deepEqual(result.refinement_work_item_ids,[4]);
  assert.equal(result.eligibility,"check-selected-work-item"); assert.deepEqual(tree,original);
  assert.equal(deliveryExecutionNavigation(root()).workflow_phase,"work_design");
  assert.equal(deliveryExecutionNavigation({...root(),status:"in-progress"}).workflow_phase,"work_design","An active Epic alone does not prove that executable work exists");
  assert.equal(deliveryExecutionNavigation(root(node(3,"Task","new"))).workflow_phase,"refinement");
});
test("metadata complete without an iteration is ready to plan while work stays in Refinement", () => {
  const missingSchedule = { ready_contract_applicable: true, ready_contract_satisfied: false,
    ready_contract_missing_fields: ["Iteration"] };
  const tree = root(node(2, "Feature", "new", [
    node(3, "User story", "new", [], missingSchedule),
    node(4, "User story", "new", [], { ...missingSchedule, ready_contract_missing_fields: ["Iteration", "Acceptance Criteria"] }),
  ], missingSchedule));
  const before = deliveryExecutionNavigation(tree);
  assert.equal(before.workflow_phase, "refinement");
  assert.deepEqual(before.planning_prepared_work_item_ids, [2, 3]);
  assert.deepEqual(before.prepared_work_item_ids, []);
  tree.children[0].children[0].ready_contract_satisfied = true;
  assert.equal(deliveryExecutionNavigation(tree).workflow_phase, "execution");
});
test("final-child completion and retirement retain closeout, including legacy work without receipts", () => {
  for (const status of ["done","retired"]) for (const epicStatus of ["new","in-progress"]) {
    const result = deliveryExecutionNavigation({...root(node(3,"Task",status)),status:epicStatus});
    assert.equal(result.workflow_phase,"execution"); assert.equal(result.package_posture,"Closeout Pending");
    assert.equal(result.closeout_pending,true); assert.equal(result.native_status,epicStatus);
  }
  const mixed=deliveryExecutionNavigation(root(node(3,"Task","done"),node(4,"Task","new")));
  assert.equal(mixed.workflow_phase,"execution"); assert.equal(mixed.closeout_pending,false);
  assert.deepEqual(mixed.refinement_work_item_ids,[4]);
});
test("blocked, deferred and terminal packages retain their distinct controls", () => {
  const tree=root(node(3,"Task","ready",[],{ready_contract_satisfied:true,dependency_blocked:true}));
  assert.equal(deliveryExecutionNavigation(tree).package_posture,"Blocked");
  assert.deepEqual(deliveryExecutionNavigation(tree).blocked_work_item_ids,[3]);
  assert.equal(deliveryExecutionNavigation({...tree,status:"parked"}).package_posture,"Deferred");
  const parentBlocked=deliveryExecutionNavigation(root(node(2,"Feature","blocked",[node(3,"Task","new")])));
  assert.equal(parentBlocked.workflow_phase,"execution");assert.equal(parentBlocked.package_posture,"Blocked");assert.deepEqual(parentBlocked.blocked_work_item_ids,[2]);
  for(const status of ["done","retired"]){const result=deliveryExecutionNavigation({...tree,status});assert.equal(result.workflow_phase,"audit_only");assert.equal(result.closeout_pending,false);}
});
test("overview reads existing caller-bound sessions once without Git or provider inspection",async()=>{
  let reads=0;
  const tree=root(node(3,"Task","new"));
  const item={epic:{id:1,record_ref:"openproject://work_packages/1",status:"new"},execution_tree:tree,execution_navigation:deliveryExecutionNavigation(tree)};
  const service=createDeliveryService({openProjectClient:{
    async listPrototypeDeliveryApplicationTargets(){return [{recordId:1,recordRef:"openproject://work_packages/1",status:"new",title:"Package"}];},
    async listDeliveryScopedInitiatives(){return [structuredClone(item)];},
  },workSessionStore:{listSessions(){reads++;return [
    {delivery_id:"delivery-1",session_id:"work-session:delivery-1:local",caller_id:"console",covered_work_item_ids:["work-item-3"],updated_at:"2026-11-17T01:00:00Z"},
    {delivery_id:"delivery-1",session_id:"work-session:delivery-1:other",caller_id:"another-caller",covered_work_item_ids:["work-item-3"]},
  ];}}});
  const result=await service.listDeliveryConsoleOverview({callerId:"console"});
  assert.equal(reads,1);const projected=result.operational_initiatives[0];
  assert.equal(projected.work_sessions.length,1);assert.equal(projected.work_sessions[0].state,"recorded");
  assert.equal(projected.execution_navigation.workflow_phase,"execution");assert.equal(projected.execution_navigation.package_posture,"In Progress");
  assert.equal(projected.execution_navigation.native_status,"new");assert.equal(result.mutation_authority,"none");
});
