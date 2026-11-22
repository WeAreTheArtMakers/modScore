import {xmlDocument} from './music';
export interface SourceLocation {x:number;y:number;box:[number,number,number,number]}
/** Model attention is approximate; it is a review aid, never ground truth. */
export function sourceLocation(note: Element): SourceLocation | undefined {
 const comments=Array.from(note.childNodes).filter(n=>n.nodeType===8).map(n=>n.textContent||'').join(' ');
 const pos=/imgpos:\s*([-\d.]+),\s*([-\d.]+)/.exec(comments);
 const area=/staff-box:\s*([-\d., ]+)/.exec(comments);
 if(!pos||!area)return;
 const box=area[1].split(',').map(Number);
 const x=Number(pos[1]),y=Number(pos[2]);
 if(box.length!==4||![x,y,...box].every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1])return;
 return {x,y,box:box as SourceLocation['box']};
}
export function verifyRecognition(xml:string,layout:{parts?:number[]},logs:string[]=[]):string {
 const doc=xmlDocument(xml);
 const parts=Array.from(doc.documentElement.children).filter(n=>n.localName==='part');
 const messages=logs.filter(m=>m.startsWith("REPAIR:")||m.startsWith("REVIEW:")).map(m=>m.slice(8));
 if(layout.parts?.length && parts.length!==layout.parts.length)
  messages.push(`Detected ${layout.parts.length} part(s), but decoded ${parts.length}. Review staff grouping before playback.`);
 if(messages.length){
  let identification=doc.querySelector('identification');
  if(!identification){identification=doc.createElement('identification');doc.documentElement.insertBefore(identification,doc.querySelector('defaults,part-list'));}
  let misc=identification.querySelector('miscellaneous');
  if(!misc){misc=doc.createElement('miscellaneous');identification.append(misc);}
  for(const message of messages){const field=doc.createElement('miscellaneous-field');field.setAttribute('name','modscore-recognition-review');field.textContent=message;misc.append(field);}
 }
 return new XMLSerializer().serializeToString(doc);
}
