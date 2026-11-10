import { assertProposalTargetArtifact, proposalTargetDigest } from "../proposal-target-application/contracts.js";
import { prototypeLandingError } from "./contracts.js";

const lifecycles = ["exploring", "candidate", "baseline-approved", "graduating", "graduated", "retired"];
// Only immutable index facts are cached. Mutable caller-owned workflow state
// is read independently on each overview request and never crosses callers.
export async function readPrototypeOverviewIndex({git,authorityRoot,revision,registry,files}) {
  const present = new Set(files);
  const rows = new Map(registry.prototypes.map(row => [row.id, {id:row.id,lifecycle:row.lifecycle,
    landed:present.has(`records/prototype-landings/${row.id}/record.json`)}]));
  const captures=files.filter(name=>/^records\/prototype-captures\/[^/]+\/record\.json$/.test(name));
  if(rows.size>10000 || captures.length>10000)throw new Error("Prototype index exceeds its entry budget.");
  for(let offset=0;offset<captures.length;offset+=4){
    const batch=captures.slice(offset,offset+4);
    const raw=await Promise.all(batch.map(name=>git(authorityRoot,"show",`${revision}:${name}`)));
    for(let index=0;index<batch.length;index++){
      if(Buffer.byteLength(raw[index])>262144)throw new Error("Prototype capture exceeds its read budget.");
      const capture=assertProposalTargetArtifact(JSON.parse(raw[index]));
      const slug=capture.record_ref.slice("record://prototype-captures/".length);
      if(batch[index]!==`records/prototype-captures/${slug}/record.json` || capture.prototype_id!==`prototype:${slug}` ||
        capture.entry_packet.entry_id!==`prototype-entry:proposal-routed:${slug}` ||
        capture.entry_packet.source.ref!==capture.proposal.record_ref || capture.entry_packet.source.revision!==capture.proposal.record_version ||
        capture.entry_packet.source.digest!==capture.proposal.handoff_packet_digest ||
        capture.entry_packet.packet_digest!==proposalTargetDigest(capture.entry_packet,"packet_digest"))throw new Error("Invalid Prototype capture binding.");
      if(!rows.has(slug))rows.set(slug,{id:slug,lifecycle:"exploring",landed:false});
    }
  }
  if(rows.size>10000 || [...rows.values()].some(row=>!lifecycles.includes(row.lifecycle)))throw new Error("Invalid Prototype lifecycle.");
  return {schema_version:1,workflow_id:"prototype-overview-index",authority_revision:revision,records:[...rows.values()],canonical_mutation:false};
}

export async function summarizePrototypeOverview(index,{callerId,landing,maturity}) {
  if(index?.workflow_id!=="prototype-overview-index" || !Array.isArray(index.records) || typeof landing?.overview!=="function" || typeof maturity?.overview!=="function")
    throw prototypeLandingError("overview_unavailable","Complete Prototype overview authority is unavailable.",503);
  const counts={total:index.records.length,exploring:0,candidate:0,baselineApproved:0,graduating:0,graduated:0,retired:0,blocked:0,movementReady:0};
  const keys={"baseline-approved":"baselineApproved"};
  const [landings,promotions]=await Promise.all([landing.overview({callerId}),maturity.overview({callerId})]);
  if(!Array.isArray(landings)||!Array.isArray(promotions))throw prototypeLandingError("overview_unavailable","Complete Prototype progress is unavailable.",503);
  const landedIds=new Set(landings.filter(row=>row.source_accepted).map(row=>row.prototype_id));
  const promotionById=new Map();
  for(const row of promotions){const rows=promotionById.get(row.prototype_id)??[];rows.push(row);promotionById.set(row.prototype_id,rows);}
  for(const row of index.records){
    if(!lifecycles.includes(row.lifecycle))throw prototypeLandingError("overview_unavailable","Invalid Prototype overview lifecycle.",503);
    counts[keys[row.lifecycle]??row.lifecycle]++;
    const progress=promotionById.get(`prototype:${row.id}`)??[];
    if(progress.some(item=>item.status==="blocked" && (row.lifecycle==="exploring"&&item.transition==="candidate-promotion" || row.lifecycle==="candidate"&&item.transition==="baseline-promotion")))counts.blocked++;
    if(row.lifecycle==="baseline-approved"&&(row.landed||landedIds.has(`prototype:${row.id}`))&&progress.some(item=>item.transition==="baseline-promotion"&&item.source_accepted))counts.movementReady++;
  }
  return {schema_version:1,workflow_id:"prototype-overview",authority_revision:index.authority_revision,counts,canonical_mutation:false};
}
