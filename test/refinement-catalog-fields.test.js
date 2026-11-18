import test from "node:test";
import assert from "node:assert/strict";
import { refinementCatalogMetadata, refinementFieldValueError, refinementSelectedField } from "../src/refinement/catalog-fields.js";
import { DELIVERY_PLANNING_WORKFLOW } from "../src/delivery-taxonomy.js";

// A complete Catalog wire fixture is exercised by source/HTTP tests. These
// value checks additionally prove that legacy text is not treated as prose.
test("governed identifiers reject arbitrary text, invalid dates and malformed references",()=>{
 const field={required:true,status:"complete",field_kind:"select",allowed_values:["existing-repo"],backend_field:"owner_repo"};
 assert.equal(refinementFieldValueError(field,"existing-repo"),null);
 assert.match(refinementFieldValueError(field,"typo-repo"),/offered/);
 assert.match(refinementFieldValueError({...field,field_kind:"number"},"-2"),/zero/);
 for(const value of ["tomorrow","2026-02-30"])assert.match(refinementFieldValueError({...field,field_kind:"short_text",backend_field:"risk_review_date"},value),/real date/);
 assert.equal(refinementFieldValueError({...field,field_kind:"short_text",backend_field:"risk_review_date"},"2026-02-28"),null);
 assert.match(refinementFieldValueError({...field,field_kind:"short_text",backend_field:"architecture_anchor_ref"},"anything"),/reference/);
 assert.equal(refinementFieldValueError({...field,field_kind:"long_text",backend_field:"definition_of_done"},"Operator authored prose"),null);
});

test("Catalog outage blocks governed choices while retaining unrelated narrative fields",()=>{
 const m={one:{target_pi:{field_kind:"short_text",writable:true},business_objective:{field_kind:"long_text",writable:true}}};
 const projected=refinementCatalogMetadata(m,null);
 assert.equal(projected.one.target_pi.field_kind,"select");assert.equal(projected.one.target_pi.unavailable,true);
 assert.deepEqual(projected.one.target_pi.allowed_values,[]);assert.deepEqual(projected.one.business_objective,m.one.business_objective);
 assert.equal(m.one.target_pi.field_kind,"short_text");
});

export function catalogFixture() {
 const definitions=[['target_pi','catalog-target-pi'],['iteration','catalog-iteration'],['owner_repo','catalog-owner-repo'],['delivery_team','catalog-delivery-team'],['assignable_principal','catalog-principal-lookup']];
 const items=definitions.map(([key,id])=>({catalog_item_id:id,group_id:'planning',label:key,description:'Canonical values',value_key:key,source_authority:'OpenProject',backend_route:'/catalog',owner_route:'platform',create_authority:'Catalog',console_capability:'request',gap_status:'backend_created',lifecycle_state:'active',usage_count:0,usage_summary:'None',evidence_refs:[],last_projected_at:null,next_action_label:'Manage',next_action_detail:'Catalog owns values'}));
 const entries={target_pi:['PI-test',DELIVERY_PLANNING_WORKFLOW.roadmap_unassigned_version_name,DELIVERY_PLANNING_WORKFLOW.roadmap_retired_version_name],iteration:['PI-test / Iteration 1'],owner_repo:['registered-repo'],delivery_team:['Known Team'],assignable_principal:['known-user']};
 return {schema_version:1,source_revision:'catalog-fixture-1',projection_status:'ready',projected_at:'2026-11-19T00:00:00Z',summary:{total_items:5,requestable_count:5,owner_routed_count:0,missing_route_count:0,drift_count:0},groups:[{group_id:'planning',title:'Planning',description:'Native options',source_authority:'OpenProject',expected_route:'/catalog',route_status:'implemented',item_ids:items.map(i=>i.catalog_item_id)}],items,values:items.flatMap(i=>entries[i.value_key].map((v,index)=>({catalog_item_id:i.catalog_item_id,catalog_value_id:i.catalog_item_id+'-'+index,value_key:v,label:v,description:'',lifecycle_state:'active',usage_count:0,usage_summary:'None',evidence_refs:[],last_projected_at:null})))};
}

test("native Catalog supplies PI, iteration, repositories, teams and principals without roadmap buckets",()=>{
 const keys=['target_pi','iteration','owner_repo','delivery_team','assignee_login','responsible_login'];
 const metadata={one:Object.fromEntries(keys.map(k=>[k,{writable:true,field_kind:'short_text'}]))};
 const catalog=catalogFixture();
 catalog.values.push({...catalog.values[0],catalog_value_id:'retired-pi',value_key:'PI-retired',lifecycle_state:'retired'});
 const result=refinementCatalogMetadata(metadata,catalog);
 for(const key of keys){assert.equal(result.one[key].field_kind,'select');assert.equal(result.one[key].unavailable,false);assert.ok(result.one[key].allowed_values.length);}
 assert.deepEqual(result.one.target_pi.allowed_values,['PI-test']);
 assert.deepEqual(result.one.assignee_login.allowed_values,['known-user']);
 // Native per-field permissions narrow Catalog choices, never broaden them.
 metadata.one.assignee_login={writable:true,field_kind:'select',allowed_values:['another-user']};
 assert.deepEqual(refinementCatalogMetadata(metadata,catalog).one.assignee_login.allowed_values,[]);
});


test("selected item choices are independent of unrelated siblings and shared edits intersect only their selected targets", () => {
 const field={field_kind:"select",required:true,status:"complete",allowed_values:[],target_allowed_values:{a:["Enabler","Shared"],b:["Business","Shared"],c:["Other"]},target_statuses:{a:"complete",b:"complete",c:"blocked"}};
 assert.deepEqual(refinementSelectedField(field,["a"]).allowed_values,["Enabler","Shared"]);
 assert.equal(refinementFieldValueError(refinementSelectedField(field,["a"]),"Enabler"),null);
 assert.deepEqual(refinementSelectedField(field,["a","b"]).allowed_values,["Shared"]);
 assert.match(refinementFieldValueError(refinementSelectedField(field,["a","b"]),"Enabler"),/offered/);
 assert.equal(refinementSelectedField(field,["a","c"]).status,"blocked");
});

test("integer fields reject truncation and unsafe values while decimal fields retain fractions", () => {
 const field={field_kind:"number",numeric_type:"integer",required:true,status:"complete"};
 for(const value of ["1.5","0x10","1e3","12abc","9007199254740993","-1"])
   assert.match(refinementFieldValueError(field,value),/whole number/);
 for(const value of ["0","12"])assert.equal(refinementFieldValueError(field,value),null);
 for(const value of ["1.5","1e3"])assert.equal(refinementFieldValueError({...field,numeric_type:"decimal"},value),null);
 assert.match(refinementFieldValueError({...field,numeric_type:"decimal"},"0x10"),/number/);
});
