import { prototypeLandingError } from "./contracts.js";

const slug = /^[a-z0-9][a-z0-9._-]{0,185}$/;
export function selectPrototypeRecordPage({registry,files,revision,selection}) {
  const ids = [...new Set([...registry.prototypes.map(row => row.id), ...files.flatMap(name => {
    const match = /^records\/prototype-captures\/([^/]+)\/record\.json$/.exec(name);
    return match ? [match[1]] : [];
  })])].sort();
  if (ids.some(id => typeof id !== "string" || !slug.test(id))) throw invalid();
  let after = null;
  if (selection.cursor) {
    try {
      if (typeof selection.cursor !== "string" || selection.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(selection.cursor)) throw Error();
      const value = JSON.parse(Buffer.from(selection.cursor,"base64url").toString());
      if (Object.keys(value).sort().join(",") !== "after,revision" || value.revision !== revision || !ids.includes(value.after)) throw Error();
      after = value.after;
    } catch { throw invalid(); }
  }
  if (selection.id && (!slug.test(selection.id) || selection.cursor)) throw invalid();
  if(selection.id&&!ids.includes(selection.id))throw prototypeLandingError("record_not_found","The selected original Prototype is not present in current owner source.",404);
  const candidates = selection.id ? ids.filter(id => id === selection.id) : ids.filter(id => after === null || id > after);
  const selected = candidates.slice(0,25), more = candidates.length > selected.length;
  return { ids:selected, total:ids.length, next_cursor:more ? Buffer.from(JSON.stringify({revision,after:selected.at(-1)})).toString("base64url") : null,
    source_revision:revision, selected_id:selection.id ?? null };
}

// Read owner evidence for this page only. A registry reference can point outside
// the project's own directory (for example a dated design baseline), so include
// exact record references and their transitive references as well as own files.
export async function readPrototypePageDocuments({git,authorityRoot,revision,registry,files,page}) {
  let bytes=0;const documents={},available=new Set(files),selected=new Set(page.ids);
  const referenceFiles=value=>{
    if(typeof value==='string' && value.startsWith('record://')){
      const stem=`records/${value.slice(9)}`;
      return [stem,`${stem}.json`,`${stem}.yaml`,`${stem}/record.json`,`${stem}/record.yaml`].filter(name=>available.has(name));
    }
    if(Array.isArray(value))return value.flatMap(referenceFiles);
    if(value&&typeof value==='object')return Object.values(value).flatMap(referenceFiles);
    return [];
  };
  const rows=registry.prototypes.filter(row=>selected.has(row.id));
  const pending=new Set([...referenceFiles(rows),...files.filter(name=>page.ids.some(id=>name.startsWith(`records/prototype-captures/${id}/`)||name.startsWith(`records/prototype-landings/${id}/`)||name.startsWith(`records/prototype-maturity/${id}/`)||name.startsWith(`records/prototype-closure/${id}/`)))]);
  while(pending.size){
    const batch=[...pending].filter(name=>!Object.hasOwn(documents,name)).slice(0,4);
    if(!batch.length)break;
    if(Object.keys(documents).length+batch.length>512)throw new Error('Selected Prototype evidence exceeds the page read budget.');
    const values=await Promise.all(batch.map(name=>git(authorityRoot,'show',`${revision}:${name}`)));
    for(let i=0;i<batch.length;i++){
      pending.delete(batch[i]);bytes+=Buffer.byteLength(values[i]);
      if(Buffer.byteLength(values[i])>262144||bytes>2*1024*1024)throw new Error('Selected Prototype evidence exceeds the page read budget.');
      // Current record roots use JSON. YAML remains parsed by the owner reader.
      const raw=values[i],value=batch[i].endsWith('.json')?JSON.parse(raw):await parseYamlDocument(raw);
      if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Invalid owner record document.');
      documents[batch[i]]=value;
      for(const name of referenceFiles(value))if(!Object.hasOwn(documents,name))pending.add(name);
    }
  }
  return documents;
}
async function parseYamlDocument(raw){const {parse}=await import('yaml');return parse(raw,{maxAliasCount:0,uniqueKeys:true});}
function invalid(){return prototypeLandingError('page_invalid','The Prototype source or page selection changed. Refresh the first page.',400);}
