import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const [root]=process.argv.slice(2),reports=[];
for(const kind of ['robot','cat'])for(const mode of ['rig','three-d','retarget']){
 const dir=path.join(root,kind),prefix=mode==='three-d'?'three-d/frame-':mode==='retarget'?'retarget-':kind==='cat'?'constrained/frame-':'frame-';
 const raw=[];for(let i=0;i<24;i++)raw.push(await sharp(path.join(dir,`${prefix}${i}.png`)).ensureAlpha().raw().toBuffer());
 assert(raw[0].equals(raw[23]),`${kind} ${mode} loop seam`);
 const unique=new Set(raw.map(p=>p.toString('base64'))).size;assert(unique>5);
 let outside=0,maxChanged=0;
 for(const p of raw){let changed=0;for(let y=0;y<128;y++)for(let x=0;x<240;x++){const i=(y*240+x)*4;if(!p.subarray(i,i+4).equals(raw[0].subarray(i,i+4))){changed++;if(x<87||x>173||y<24||y>105)outside++;}}maxChanged=Math.max(changed,maxChanged);}
 if(mode!=='three-d')assert.equal(outside,0,'Unexpected background/scene changes');
 reports.push({kind,mode,frames:24,unique,loopExact:true,outsideMotionWindow:outside,maxChangedPixels:maxChanged});
 const panels=await Promise.all([0,4,8,12,16,20].map(async i=>({input:await fs.readFile(path.join(dir,`${prefix}${i}.png`)),left:[0,4,8,12,16,20].indexOf(i)*240,top:0})));
 await sharp({create:{width:1440,height:128,channels:4,background:'#121c32'}}).composite(panels).png().toFile(path.join(dir,`${mode}-contact.png`));
}
await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
