import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const manifest=JSON.parse(await readFile('docs/ASSET_MANIFEST.json','utf8'));
for(const asset of manifest){
 const bytes=await readFile('dist'+asset.path);
 if(bytes.length!==asset.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Distribution asset differs: '+asset.path);
}
const expected=createHash('sha256').update(JSON.stringify(manifest.filter(a=>a.path!=='/sw.js'))).digest('hex').slice(0,12);
const worker=await readFile('dist/sw.js','utf8');
if(!worker.includes(`const VERSION = "modscore-shell-${expected}"`))throw Error('Service worker version differs from asset manifest');
const archive=execFileSync('tar',['-tzf','dist/source.tar.gz'],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\n');
if(archive.some(path=>/^(?:\.\/)?(?:omr-validation|node_modules|dist)\//.test(path)))throw Error('Private/generated content entered source archive');
for(const required of ['src/main.ts','README.md','LICENSE','vendor/partsong/omr-rs/src/barlines.rs'])if(!archive.includes(required))throw Error('Missing corresponding source: '+required);
console.log(`Verified ${manifest.length} distribution hashes, service-worker version and corresponding-source contents.`);
