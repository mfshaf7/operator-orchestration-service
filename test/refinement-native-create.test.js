import assert from "node:assert/strict";
import test from "node:test";
import { createOpenProjectClient } from "../src/openproject-client.js";
import { createDeliveryService } from "../src/delivery-service.js";

// Synthetic HTTP backend only. The Delivery service and OpenProject create,
// permission/form resolution, planning guards and readback are the real code.
function nativeCreate({type, parentPi = null}) {
  const calls = [];
  const records = new Map();
  const parentType = type === "User story" ? "Feature" : type === "Task" ? "User story" : "Epic";
  const typeLink = {href:"/api/v3/types/10",title:type};
  const response = (body, status = 200) => ({ok:true,status,text:async()=>JSON.stringify(body)});
  const client = createOpenProjectClient({
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
