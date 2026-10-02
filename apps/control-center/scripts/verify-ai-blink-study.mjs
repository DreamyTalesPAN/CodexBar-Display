import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const [sourcePath,sourcePNG,study]=process.argv.slice(2);
const original=JSON.parse(await fs.readFile(sourcePath,'utf8'));
const result=JSON.parse(await fs.readFile(path.join(study,'design.json'),'utf8'));
const candidates=JSON.parse(await fs.readFile(path.join(study,'candidates.json'),'utf8'));
// These two source IDs were visually inspected in each reviewed fixture.
const eyes=candidates.filter(c=>[1,2].includes(c.id));
assert.equal(eyes.length,2);
const mask=new Set();
for(const eye of eyes)for(let x=eye.left;x<eye.left+eye.width;x++){
 const ys=eye.pixels.filter(p=>p[0]===x).map(p=>p[1]);if(!ys.length)continue;
 for(let y=Math.min(...ys);y<=Math.max(...ys);y++)mask.add(y*240+x);
}
const source=await sharp(sourcePNG).ensureAlpha().raw().toBuffer();
const counts=[];
for(let frame=0;frame<3;frame++){
 const data=await sharp(path.join(study,`pose-${frame}.png`)).ensureAlpha().raw().toBuffer();assert.equal(data.length,source.length);
 let changed=0;for(let i=0;i<data.length;i+=4)if(!data.subarray(i,i+4).equals(source.subarray(i,i+4))){changed++;assert(mask.has(i/4),'Changed pixel outside the source eye masks');}
 if(frame===0)assert.equal(changed,0);counts.push(changed);
}
const art='/themes/u/ai-screen.cbi',loop='/themes/u/ai-scene-loop.cba';
assert.deepEqual(result.assets[art],original.assets[art]);
assert.deepEqual(result.spec.primitives.filter(p=>!p.assetPath),original.spec.primitives.filter(p=>!p.assetPath));
assert.match(result.assets[loop].data,/^CBA1\n\d+ \d+ 8 4\n/);
assert.equal(result.spec.primitives.find(p=>p.assetPath===loop).frameCount,8);
console.log(JSON.stringify({study,changedPixels:counts,outsideEyeMasksChangedPixels:0,backgroundAssetExact:true,manualPrimitivesExact:true,frameCount:8}));
