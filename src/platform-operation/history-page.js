import {createHash} from 'node:crypto';
import {opendirSync,statSync} from 'node:fs';
import path from 'node:path';
import {HttpError} from '../errors.js';
const kinds={all:null,'dev-integration':['dev-integration-profile','profile-request'],'governed-releases':['product-release','product-runtime-lifecycle']};
const hash=value=>createHash('sha256').update(value).digest('hex');
export function createOperationHistoryPager({directory,read}){
 const metadata=new Map();
 return function page({workspace='all',limit=10,cursor=null}={}){
  if(!Object.hasOwn(kinds,workspace)||!Number.isSafeInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||cursor.length>512))throw new HttpError(400,'platform_history_query_invalid','Use a supported workspace and page size of1–25.');
  let before=null;
  if(cursor){try{const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(Object.keys(decoded).sort().join(',')!=='before,workspace'||decoded.workspace!==workspace||!Array.isArray(decoded.before)||decoded.before.length!==2||!Number.isSafeInteger(decoded.before[0])||typeof decoded.before[1]!=='string'||decoded.before[1].length>256)throw Error();before=decoded.before;}catch{throw new HttpError(400,'platform_history_cursor_invalid','History continuation does not match this workspace.');}}
  const seen=new Set(),rows=[];const dir=opendirSync(directory);let entry;
  try{while((entry=dir.readSync())){
   if(!entry.name.endsWith('.json'))continue;
   if(!entry.isFile()||!/^[a-f0-9]{64}\.json$/.test(entry.name))throw new HttpError(503,'platform_history_store_invalid','History metadata contains an invalid record path.');
   seen.add(entry.name);
   const filename=path.join(directory,entry.name),stat=statSync(filename,{bigint:true});const stamp=`${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`;
   let row=metadata.get(entry.name);
   if(!row||row.stamp!==stamp){const record=read(filename,'Platform operation history');if(!record?.operation_id||!record?.command?.subject?.kind||!Number.isFinite(Date.parse(record.updated_at))||!Number.isFinite(Date.parse(record.command.requested_at)))throw new HttpError(503,'platform_history_store_invalid','A canonical history record is invalid.');row={id:record.operation_id,kind:record.command.subject.kind,updated:record.updated_at,created:Date.parse(record.command.requested_at),filename,stamp};metadata.set(entry.name,row);}
   if(!kinds[workspace]||kinds[workspace].includes(row.kind))rows.push(row);
  }}finally{dir.closeSync();}
  for(const name of metadata.keys())if(!seen.has(name))metadata.delete(name);
  rows.sort((a,b)=>b.created-a.created||a.id.localeCompare(b.id));
  const snapshot=`sha256:${hash(JSON.stringify(rows.map(row=>[row.id,row.stamp])))}`;
  const remaining=before?rows.filter(row=>row.created<before[0]||row.created===before[0]&&row.id>before[1]):rows;
  const selected=remaining.slice(0,limit),records=selected.map(row=>read(row.filename,'Platform operation history'));
  for(let i=0;i<selected.length;i++){const stat=statSync(selected[i].filename,{bigint:true});if(`${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`!==selected[i].stamp)throw new HttpError(409,'platform_history_changed','History changed during the page read. Refresh it.');}
  const last=selected.at(-1);
  return {records,page:{workspace,limit,total:rows.length,snapshot,next_cursor:selected.length<remaining.length?Buffer.from(JSON.stringify({workspace,before:[last.created,last.id]})).toString('base64url'):null}};
 };
}
