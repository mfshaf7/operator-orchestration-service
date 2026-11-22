import assert from "node:assert/strict";
import test from "node:test";
import { createOpenProjectClient } from "../src/openproject-client.js";
import { createDeliveryService } from "../src/delivery-service.js";

// Synthetic HTTP backend only. The Delivery service and OpenProject create,
// permission/form resolution, planning guards and readback are the real code.
function nativeCreate({type, parentPi = null, planningCatalogReader}) {
  const calls = [];
  const records = new Map();
  const parentType = type === "User story" ? "Feature" : type === "Task" ? "User story" : "Epic";
  const typeLink = {href:"/api/v3/types/10",title:type};
  const response = (body, status = 200) => ({ok:true,status,text:async()=>JSON.stringify(body)});
  const client = createOpenProjectClient({
    planningCatalogReader,
    config:{apiToken:"test-token",baseUrl:"http://example.test",deliveryProjectIdentifier:"workspace-delivery-art",deliveryCustomFieldTargetPiId:14},
    async fetchImpl(url, options) {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({path,method:options.method,body});
      if (options.method === "GET" && path === "/api/v3/work_packages/38") {
        return response({id:38,lockVersion:1,subject:"Current parent",customField14:parentPi,_links:{type:{title:parentType},status:{title:"new"}}});
      }
      if (options.method === "GET" && path === "/api/v3/projects/workspace-delivery-art/work_packages") {
        return response({_embedded:{elements:[]},total:0,count:0,offset:1,pageSize:100});
      }
      if (options.method === "POST" && path === "/api/v3/projects/workspace-delivery-art/work_packages/form") {
        return response({_embedded:{payload:{_links:{status:{title:"new"}}},schema:{
          type:{_links:{allowedValues:[typeLink]}},
          version:{writable:false,type:"Version"},
          customField14:{location:"payload",name:"Target PI",type:"String",writable:true},
          customField32:{location:"payload",name:"Iteration",type:"String",writable:true},
          customField36:{location:"payload",name:"Execution Classification",type:"String",writable:true,_links:{allowedValues:[{href:"/api/v3/custom_options/3601",title:"Business"}]}},
        }}});
      }
      if (options.method === "POST" && path === "/api/v3/projects/workspace-delivery-art/work_packages") {
        const record = {...body,id:70,lockVersion:1,_links:{...body._links,type:typeLink,status:{title:"new"}}};
        records.set(70,record);
        return response(record,201);
      }
      if (options.method === "GET" && path === "/api/v3/work_packages/70") return response(records.get(70));
      if (options.method === "POST" && path === "/api/v3/work_packages/70/form") {
        return response({_embedded:{schema:{
          version:{writable:false,type:"Version"},
          customField14:{location:"payload",name:"Target PI",type:"String",writable:true},
          customField32:{location:"payload",name:"Iteration",type:"String",writable:true},
        }}});
      }
      if (options.method === "PATCH" && path === "/api/v3/work_packages/70") {
        const record = records.get(70);
        const updated = {...record,...body,lockVersion:record.lockVersion+1,_links:{...record._links,...body._links}};
        records.set(70,updated);
        return response(updated);
      }
      assert.fail(`Unexpected native request ${options.method} ${path}`);
    },
  });
  return {calls,records,service:createDeliveryService({openProjectClient:client,audit:{emit(){}}})};
}

for (const type of ["Feature","User story","Defect","Task","PI Objective","Risk","Milestone"]) {
  test(`native new ${type} creation retains submitted planning inputs without an execution transition`, async () => {
    const committed = type !== "Feature";
    const native = nativeCreate({type,parentPi:["User story","Task"].includes(type) ? "PI-A" : null});
    const result = await native.service.createDeliveryWorkItem({
      callerId:"console",correlationId:"native-create",parentWorkItemId:"work-item-38",type,subject:"Actual reviewed outcome",
      ...(committed ? {targetPi:"PI-A",iteration:"PI-A / Iteration 1"} : {}),
    });
    assert.equal(result.work_item_record_ref,"openproject://work_packages/70");
    const canonical = native.records.get(70);
    assert.equal(canonical._links.parent.href,"/api/v3/work_packages/38");
    assert.equal(canonical._links.status.title,"new");
    assert.equal(canonical.customField14, committed ? "PI-A" : undefined);
    assert.equal(canonical.customField32, committed ? "PI-A / Iteration 1" : undefined);
    assert.equal(native.calls.filter(call=>call.method==="POST" && call.path.endsWith("/work_packages")).length,1);
  });
}

for (const type of ["PI Objective","Task","Milestone"]) {
  test(`native ${type} rejects missing PI or Iteration before any work-package creation`, async () => {
    for (const planning of [{},{targetPi:"PI-A"},{targetPi:"PI-A",iteration:"PI-B / Iteration 1"}]) {
      const native = nativeCreate({type,parentPi:null});
      await assert.rejects(native.service.createDeliveryWorkItem({callerId:"console",correlationId:"denied",parentWorkItemId:"work-item-38",type,subject:"Reviewed outcome",...planning}));
      assert.equal(native.calls.some(call=>call.method==="POST" && call.path.endsWith("/work_packages")),false);
    }
  });
}

test("native inherited PI still requires Iteration and generic Feature commitment still requires coordinated planning", async () => {
  const feature = nativeCreate({type:"Feature",parentPi:"PI-A"});
  await assert.rejects(feature.service.createDeliveryWorkItem({callerId:"console",correlationId:"denied",parentWorkItemId:"work-item-38",type:"Feature",subject:"Backlog feature"}),/plan\/apply/);
  const child = nativeCreate({type:"User story",parentPi:"PI-A"});
  await assert.rejects(child.service.createDeliveryWorkItem({callerId:"console",correlationId:"denied",parentWorkItemId:"work-item-38",type:"User story",subject:"Inherited PI"}),/Iteration/);
  for (const native of [feature,child]) assert.equal(native.records.size,0);
});


test("direct create and update validate changed assignments while new and standalone work notes persist", async () => {
  const pi = "PI-2027-01";
  const key = `${pi} / Iteration 1`;
  const catalog = {
    projection_status: "ready",
    values: [
      { catalog_item_id: "catalog-target-pi", value_key: pi, lifecycle_state: "active" },
      { catalog_item_id: "catalog-pi-planning-date", value_key: "2027-01-11/2027-01-24",
        parent_catalog_value_key: pi, lifecycle_state: "read_only" },
      { catalog_item_id: "catalog-iteration", value_key: key, parent_catalog_value_key: pi, lifecycle_state: "active",
        iteration_window: { sequence: 1, start_date: "2027-01-11", end_date: "2027-01-24" } },
    ],
  };
  const native = nativeCreate({ type: "Risk", parentPi: pi, planningCatalogReader: async () => catalog });
  const create = { callerId: "console", correlationId: "new-note", parentWorkItemId: "work-item-38",
    type: "Risk", subject: "Prepare rollout", workNote: "Confirm the rollback owner." };
  await assert.rejects(native.service.createDeliveryWorkItem({ ...create, iteration: `${pi} / Invented` }), /Choose a saved iteration/);
  assert.equal(native.records.size, 0);
  await native.service.createDeliveryWorkItem({ ...create, iteration: key });
  assert.match(native.records.get(70).description.raw, /Operator work notes[\s\S]+console: Confirm the rollback owner/);
  const update = { callerId: "console", correlationId: "edit-note", workItemId: "work-item-70",
    workNote: "Review the release window." };
  await assert.rejects(native.service.updateDeliveryWorkItem({ ...update, iteration: `${pi} / Invented` }), /Choose a saved iteration/);
  assert.equal(native.records.get(70).customField32, key);
  catalog.values = [];
  await native.service.updateDeliveryWorkItem(update);
  assert.match(native.records.get(70).description.raw, /Confirm the rollback owner[\s\S]+Review the release window/);
  assert.equal(native.records.get(70).customField32, key);
});
