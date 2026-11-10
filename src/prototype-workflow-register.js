// Keep caller scoping in the owning store. This optional register selection
// retains the newest request per prototype/transition, while exact request and
// history reads remain independent and unchanged.
export function selectPrototypeWorkflowRecords(records, selection = null) {
  if (!selection) return records;
  const ids=selection.prototypeIds;
  if(!Array.isArray(ids)||ids.length>25||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=="string"||!/^prototype:[a-z0-9][a-z0-9._-]{0,185}$/.test(id)))throw new Error("Invalid Prototype register workflow selection.");
  const normalized=value=>typeof value==="string"?value.replace(/^prototype:/,""):null;
  const identity=record=>normalized(record.request?.prototype_id??record.evaluation?.request?.prototype_id??record.evaluation?.request?.prototype?.id);
  const wanted=new Set(ids.map(normalized));
  const selected=records.filter(record=>wanted.has(identity(record)));
  if(!selection.latestOnly)return selected;
  return latestPrototypeWorkflowRecords(selected);
}

// The owner store has already applied caller isolation before this aggregate.
export function latestPrototypeWorkflowRecords(records) {
  const normalized=value=>typeof value==="string"?value.replace(/^prototype:/,""):null;
  const identity=record=>normalized(record.request?.prototype_id??record.evaluation?.request?.prototype_id??record.evaluation?.request?.prototype?.id);
  const request=record=>record.request??record.evaluation?.request;
  const selected=[...records];
  selected.sort((a,b)=>String(a.history?.[0]?.at).localeCompare(String(b.history?.[0]?.at))||String(request(a)?.request_id).localeCompare(String(request(b)?.request_id)));
  const latest=new Map();
  for(const row of selected)latest.set(`${identity(row)}:${request(row)?.transition??request(row)?.action??"landing"}`,row);
  return [...latest.values()];
}
