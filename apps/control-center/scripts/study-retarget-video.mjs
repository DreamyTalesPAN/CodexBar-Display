// Controlled-color fixture tracker, not a general anatomy detector.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {draw,solve} from './study-animation-rigs.mjs';
const [out]=process.argv.slice(2);
for(const kind of ['robot','cat']){
 try{
 const dir=path.join(out,kind),frames=[],track=[],overlays=[];
 let previous=[152,kind==='cat'?74:79];
 for(let n=1;n<=24;n++){
  const png=await fs.readFile(path.join(dir,`raw-${String(n).padStart(2,'0')}.png`));frames.push(png);
  const p=await sharp(png).removeAlpha().raw().toBuffer(),visited=new Set(),candidates=[];
  const matches=(x,y)=>{const [r,g,b]=p.subarray((y*240+x)*3,(y*240+x)*3+3);return kind==='cat'?r>190&&g>175&&b>140&&r-g<65&&g-b<65:r>130&&g>170&&b>190&&b-r>15;};
  for(let y=28;y<103;y++)for(let x=88;x<180;x++){
   const k=y*240+x;if(visited.has(k)||!matches(x,y))continue;let q=[[x,y]],pixels=[];visited.add(k);
   while(q.length){const a=q.pop();pixels.push(a);for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=a[0]+dx,yy=a[1]+dy,kk=yy*240+xx;if(xx<88||xx>=180||yy<28||yy>=103||visited.has(kk)||!matches(xx,yy))continue;visited.add(kk);q.push([xx,yy]);}}
   if(pixels.length<3)continue;const center=[0,1].map(i=>pixels.reduce((s,a)=>s+a[i],0)/pixels.length);candidates.push({center,area:pixels.length,distance:Math.hypot(center[0]-previous[0],center[1]-previous[1])});
  }
  candidates.sort((a,b)=>a.distance-b.distance);const best=candidates[0];
  if(!best||best.distance>28)throw Error(`${kind} tracking failed at ${n}; no invented motion`);
  previous=best.center;track.push({...best,frame:n});
  const mark=Buffer.from(`<svg width="240" height="128"><circle cx="${previous[0]}" cy="${previous[1]}" r="6" fill="none" stroke="#ff00cc" stroke-width="1"/></svg>`);
  const overlay=await sharp(png).composite([{input:mark}]).png().toBuffer();overlays.push(overlay);await fs.writeFile(path.join(dir,`tracked-${n-1}.png`),overlay);
 }
 await sharp({create:{width:1440,height:512,channels:4,background:'#121c32'}}).composite(overlays.map((input,i)=>({input,left:i%6*240,top:Math.floor(i/6)*128}))).png().toFile(path.join(dir,'tracked-sheet.png'));
 // Subtract measured end drift to close the path, smooth three samples, retain
 // source art via the same renderer. This correction is reported explicitly.
 const start=track[0].center,end=track.at(-1).center,drift=end.map((v,j)=>v-start[j]);
 const deltas=track.map((v,i)=>v.center.map((p,j)=>p-start[j]-drift[j]*i/23));
 const smooth=deltas.map((v,i)=>v.map((p,j)=>(deltas[Math.max(0,i-1)][j]+2*p+deltas[Math.min(23,i+1)][j])/4));
 const s0=smooth[0],s1=smooth.at(-1);let clamped=0;
 const trajectory=smooth.map((v,i)=>{let w=v.map((p,j)=>[20,10][j]+p-s0[j]-(s1[j]-s0[j])*i/23);const r=Math.hypot(...w);if(r>31.8){clamped++;w=w.map(p=>p*31.8/r);}solve(w);return w;});
 const rendered=[];
 for(let i=0;i<24;i++){const png=await sharp(Buffer.from(draw(kind,trajectory[i]))).png().toBuffer();rendered.push(png);await fs.writeFile(path.join(dir,`retarget-${i}.png`),png);}
 await fs.writeFile(path.join(dir,'video-track.json'),JSON.stringify({method:'fixture-color-components',manualROI:[88,28,92,75],track,drift,clamped,trajectory},null,2));
 await sharp({create:{width:1440,height:512,channels:4,background:'#121c32'}}).composite(rendered.map((input,i)=>({input,left:i%6*240,top:Math.floor(i/6)*128}))).png().toFile(path.join(dir,'retarget-sheet.png'));
 console.log({kind,drift,clamped,range:[0,1].map(j=>Math.max(...track.map(p=>p.center[j]))-Math.min(...track.map(p=>p.center[j])))});
 }catch(error){await fs.writeFile(path.join(out,kind,'tracking-failed.json'),JSON.stringify({error:error.message}));console.log({kind,error:error.message});}
}
