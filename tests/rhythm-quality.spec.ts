import {test,expect} from '@playwright/test';
const score = (body: string) => `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>48</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>G</sign><line>2</line></clef></attributes>${body}</measure></part></score-partwise>`;
const n=(step:string,octave:number,voice:number,duration:number,extra='')=>`<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>16th</type><staff>${voice}</staff>${extra}</note>`;
test('pitch-only correction preserves tuplet rhythm, beams and tuplets',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async(xml)=>{
  const {parseMusicXML,amendNote}=await import('/src/music.ts');
  const t=parseMusicXML(xml);const output=amendNote(xml,t.notes[0],63,t.notes[0].duration);
  const d=new DOMParser().parseFromString(output,'application/xml');
  return {pitch:parseMusicXML(output).notes[0].pitch,type:d.querySelector('note > type')?.textContent,actual:d.querySelector('actual-notes')?.textContent,beam:d.querySelector('beam')?.textContent,mark:d.querySelector('tuplet')?.getAttribute('type')};
 },score(n('C',4,1,4,'<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">begin</beam><notations><tuplet type="start"/></notations>').replace('<type>16th</type>','<type>32nd</type>')));
 expect(result).toEqual({pitch:63,type:'32nd',actual:'3',beam:'begin',mark:'start'});
});
test('short duration correction reflows its voice without shifting the other piano staff',async({page})=>{
 await page.goto('/');
 const xml=score(n('C',4,1,12)+'<backup><duration>12</duration></backup>'+n('C',3,2,12)+n('D',4,1,12)+'<backup><duration>12</duration></backup>'+n('D',3,2,12));
 const result=await page.evaluate(async(xml)=>{
  const {parseMusicXML,amendNote}=await import('/src/music.ts');
  const original=parseMusicXML(xml);const output=amendNote(xml,original.notes.find(n=>n.pitch===60)!,60,.0625);
  const t=parseMusicXML(output),d=new DOMParser().parseFromString(output,'application/xml');
  return {notes:t.notes.map(n=>[n.pitch,n.beat,n.duration]),type:d.querySelector('note > type')?.textContent,beforeStart:t.warnings.some(w=>w.includes('before the start'))};
 },xml);
 expect(result).toEqual({notes:[[60,0,.0625],[48,0,.25],[62,.0625,.25],[50,.25,.25]],type:'64th',beforeStart:false});
});
test('an explicit short triplet correction exports exact duration and type',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async(xml)=>{
  const {parseMusicXML,amendNote}=await import('/src/music.ts');
  const t=parseMusicXML(xml);const output=amendNote(xml,t.notes[0],60,1/6);
  const d=new DOMParser().parseFromString(output,'application/xml');
  return {duration:parseMusicXML(output).notes[0].duration,ticks:d.querySelector('note > duration')?.textContent,type:d.querySelector('note > type')?.textContent,actual:d.querySelector('actual-notes')?.textContent,normal:d.querySelector('normal-notes')?.textContent};
 },score(n('C',4,1,12)));
 expect(result).toEqual({duration:1/6,ticks:'8',type:'16th',actual:'3',normal:'2'});
});
test('tied note pitch-only edits do not demand moving the tie',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async(xml)=>{
  const {parseMusicXML,amendOnset,amendNote}=await import('/src/music.ts');
  const t=parseMusicXML(xml),note=t.notes[0];
  const output=amendNote(amendOnset(xml,note,note.beat),note,61,note.duration);
  return parseMusicXML(output).notes.map(n=>[n.pitch,n.duration,n.source.length]);
 },score(n('C',4,1,12,'<tie type="start"/>')+n('C',4,1,12,'<tie type="stop"/>')));
 expect(result).toEqual([[61,.5,2]]);
});
test('recognition notices survive page merging and retain source-page association',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {verifyRecognition}=await import('/src/recognition-review.ts');
  const {mergePages,parseMusicXML}=await import('/src/music.ts');
  const xml=await(await fetch('/fixtures/grand-staff.musicxml')).text();
  const checked=verifyRecognition(xml,{parts:[2,1]});
  const merged=mergePages([checked,checked],'review');
  const t=parseMusicXML(merged);
  return {notes:t.notes.length,pages:t.measures.map(m=>m.page),warning:t.warnings.some(w=>w.includes('Detected 2 part(s), but decoded 1'))};
 });
 expect(result).toEqual({notes:38,pages:[0,0,0,0,1,1,1,1],warning:true});
});
test('re-recognition creates a fresh draft and preserves the earlier score',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {saveScore}=await import('/src/storage.ts');
  const xml=await(await fetch('/fixtures/grand-staff.musicxml')).text();
  const image=await(await fetch('/tests/fixtures/treble-clef-piano.png')).blob();
  await saveScore({id:'old',title:'Earlier recognition',xml,pages:[image],originals:[image],recognizedPages:[xml],created:1,updated:1,reviewed:false});
 });
 await page.reload();await page.getByRole('button',{name:'My scores',exact:true}).first().click();
 await page.locator('.score-open').click();await page.locator('.score-actions summary').click();
 await page.getByRole('button',{name:'Recognize again (copy)',exact:true}).click();
 await expect(page.locator('.scan-preview img')).toBeVisible();
 await expect(page.locator('#scan-status')).toContainText('previous score is kept');
 const records=await page.evaluate(async()=>{const {listScores}=await import('/src/storage.ts');return(await listScores()).map(p=>({id:p.id,xml:!!p.xml,checkpoints:p.recognizedPages?.length||0}));});
 expect(records).toHaveLength(2);expect(records.find(p=>p.id==='old')).toEqual({id:'old',xml:true,checkpoints:1});
 expect(records.find(p=>p.id!=='old')).toMatchObject({xml:false,checkpoints:0});
});
test('real piano OMR preserves one part when the lower staff changes between treble and bass clefs',async({page,isMobile})=>{
 test.skip(isMobile,'Actual inference is covered by desktop; this is a simulated mobile viewport.');
 test.setTimeout(240000);
 await page.goto('/');await page.locator('#files').setInputFiles('tests/fixtures/treble-clef-piano.png');
 await page.getByRole('button',{name:'Recognize locally',exact:true}).click();
 await expect(page.locator('#notation svg').first()).toBeVisible({timeout:210000});
 const result=await page.evaluate(async()=>{
  const {listScores}=await import('/src/storage.ts');
  const p=(await listScores()).find(p=>p.xml)!;
  const doc=new DOMParser().parseFromString(p.xml,'application/xml');
  return {parts:doc.querySelectorAll('part-list > score-part').length,staves:doc.querySelector('staves')?.textContent};
 });
 expect(result).toEqual({parts:1,staves:'2'});
 await page.getByRole('tab',{name:'Review notes',exact:true}).click();
 await expect(page.locator('#source-excerpt')).toBeVisible();
 expect(await page.locator('#source-canvas').evaluate((c:HTMLCanvasElement)=>c.width)).toBeGreaterThan(0);
});
test('128th-note duration raises the tick grid without altering the other staff',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async(xml)=>{
  const {parseMusicXML,amendNote}=await import('/src/music.ts');const t=parseMusicXML(xml);
  const out=amendNote(xml,t.notes.find(n=>n.pitch===60)!,60,1/32);
  const d=new DOMParser().parseFromString(out,'application/xml');return {divisions:d.querySelector('divisions')?.textContent,type:d.querySelector('note > type')?.textContent,notes:parseMusicXML(out).notes.map(n=>[n.pitch,n.beat,n.duration])};
 },score(n('C',4,1,12)+'<backup><duration>12</duration></backup>'+n('C',3,2,12)+n('D',4,1,12)+'<backup><duration>12</duration></backup>'+n('D',3,2,12)));
 expect(result).toEqual({divisions:'96',type:'128th',notes:[[60,0,1/32],[48,0,.25],[62,1/32,.25],[50,.25,.25]]});
});
test('a fine onset edit rescales durations and offsets without changing other notes',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async(xml)=>{
  const {parseMusicXML,amendOnset}=await import('/src/music.ts');const t=parseMusicXML(xml);
  const out=amendOnset(xml,t.notes[0],1/32);const d=new DOMParser().parseFromString(out,'application/xml');
  return {divisions:d.querySelector('divisions')?.textContent,notes:parseMusicXML(out).notes.map(n=>[n.pitch,n.beat,n.duration])};
 },score(n('C',4,1,12)+n('D',4,1,12)));
 expect(result).toEqual({divisions:'96',notes:[[60,1/32,.25],[62,.25,.25]]});
});
