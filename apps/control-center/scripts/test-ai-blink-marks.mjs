// Research harness: source components -> visual ID selection -> drawn eyelids.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const [designFile,imageFile,output]=process.argv.slice(2);
const design=JSON.parse(await fs.readFile(designFile,'utf8'));
const original=await sharp(imageFile).ensureAlpha().raw().toBuffer();
const fixtureRegion=process.env.BLINK_REGION?.split(',').map(Number);
const region=design.spec.primitives.find(p=>p.assetPath?.endsWith('.cba')) || (fixtureRegion?{x:fixtureRegion[0],y:fixtureRegion[1],width:fixtureRegion[2],height:fixtureRegion[3],assetPath:'/themes/u/ai-scene-loop.cba'}:null);
if(!region)throw Error('A source animation window or explicit fixture region is required');
const {x:rx,y:ry,width:rw,height:rh}=region;
await fs.mkdir(output,{recursive:true});
const visited=new Set(), candidates=[];
const dark=(x,y)=>{const i=(y*240+x)*4;return .2126*original[i]+.7152*original[i+1]+.0722*original[i+2]<50;};
for(let y=ry;y<ry+rh;y++)for(let x=rx;x<rx+rw;x++){
 const key=y*240+x;if(visited.has(key)||!dark(x,y))continue;
 const queue=[[x,y]],pixels=[];visited.add(key);let edge=false;
 while(queue.length){const [a,b]=queue.pop();pixels.push([a,b]);if(a===rx||b===ry||a===rx+rw-1||b===ry+rh-1)edge=true;
  for(const [xx,yy] of [[a-1,b],[a+1,b],[a,b-1],[a,b+1]]){const k=yy*240+xx;if(xx<rx||yy<ry||xx>=rx+rw||yy>=ry+rh||visited.has(k)||!dark(xx,yy))continue;visited.add(k);queue.push([xx,yy]);}}
 const xs=pixels.map(p=>p[0]),ys=pixels.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys),width=Math.max(...xs)-left+1,height=Math.max(...ys)-top+1;
 // Three distinct eyelid states need a genuinely open, multi-row eye. Tiny
 // dark strokes cannot support this operator (they may be closed eyes/stripes).
 if(!edge&&pixels.length>=12&&pixels.length<=96&&width>=4&&width<=14&&height>=4&&height<=14)candidates.push({id:candidates.length+1,left,top,width,height,pixels});
}
const scale=12;
const crop=await sharp(imageFile).extract({left:rx,top:ry,width:rw,height:rh}).resize(rw*scale,rh*scale,{kernel:'nearest'}).png().toBuffer();
let marks=`<svg width="${rw*scale}" height="${rh*scale}">`;
for(const c of candidates){const x=(c.left-rx)*scale,y=(c.top-ry)*scale;
 marks+=`<rect x="${x}" y="${y}" width="${c.width*scale}" height="${c.height*scale}" fill="none" stroke="#00ffff" stroke-width="2"/><rect x="${x}" y="${y-18}" width="24" height="18" fill="#001122"/><text x="${x+3}" y="${y-4}" font-family="sans-serif" font-weight="bold" font-size="16" fill="#00ffff">${c.id}</text>`;}
marks+='</svg>';
const marked=await sharp(crop).composite([{input:Buffer.from(marks)}]).png().toBuffer();
await fs.writeFile(path.join(output,'marked.png'),marked);
await fs.writeFile(path.join(output,'candidates.json'),JSON.stringify(candidates));
console.log(JSON.stringify(candidates.map(({pixels,...c})=>({...c,area:pixels.length}))));
if(!process.env.ALLOW_PAID_AI_TEST&&!process.env.BLINK_IDS&&!process.env.REPLAY_MARK_SELECTION)process.exit(0);
if(candidates.length<2){await fs.writeFile(path.join(output,'unsupported.json'),JSON.stringify({reason:'No pair of supported open-eye geometries',providerCalls:0}));throw Error('Unsupported eye geometry; no provider call, no changed design');}
let ids=process.env.BLINK_IDS?.split(',').map(Number);
if(process.env.REPLAY_MARK_SELECTION){ids=JSON.parse(JSON.parse(await fs.readFile(process.env.REPLAY_MARK_SELECTION,'utf8')).style.artPrompt).eyes;}
if(!ids){
 const style={packName:'Blink study',title:'Blink',notes:'Read numbered source shapes.',artPrompt:'Preserve exactly.',environmentPrompt:'Numbered boxes are immutable regions extracted from original pixels. Select IDs, never coordinates.',animationMode:'static',animationPrompt:'',backgroundColor:'#112233',panelColor:'#112233',textColor:'#ffffff',sessionColor:'#ffffff',weeklyColor:'#ffffff',borderRadius:0,progressStyle:'solid'};
 const prompt='Keep the image completely unchanged: animationMode=static, preserveArtwork=true. Do not generate or edit images. In artPrompt return ONLY JSON {"eyes":[ID,ID]}. Inspect the numbered cyan boxes in the supplied magnified source. Select the TWO boxes enclosing the two OPEN EYES of the main character, NOT nostrils, eyebrows, fur, clothing, ears or background. IDs already map exactly to original source pixels. Do not invent coordinates or new shapes. If neither pair of boxes are actual eyes, return {"eyes":[]}. Notes briefly explain your selected IDs. This is a grounding experiment, not a request for a generated pose.';
 const start=Date.now();const r=await fetch('http://127.0.0.1:47852/v1/ai-theme/concepts',{method:'POST',headers:{Origin:'http://127.0.0.1:47852','Content-Type':'application/json'},body:JSON.stringify({target:'auto',prompt,previous:{style,imageContentType:'image/png',imageBase64:(await fs.readFile(imageFile)).toString('base64'),referenceImageBase64:marked.toString('base64')}})});
 const result=await r.json();await fs.writeFile(path.join(output,'provider.json'),JSON.stringify(result));console.log(JSON.stringify({status:r.status,seconds:(Date.now()-start)/1000,style:result.style,error:result.error}));
 if(!r.ok||result.style?.animationMode!=='static'||!result.style.preserveArtwork)throw Error('Failed grounding experiment');ids=JSON.parse(result.style.artPrompt).eyes;
}
if(ids.length!==2||ids[0]===ids[1]||ids.some(id=>!candidates.find(c=>c.id===id)))throw Error('No valid eye selection; original untouched');
const selected=ids.map(id=>candidates.find(c=>c.id===id));
const poses=[Buffer.from(original),Buffer.from(original),Buffer.from(original)];
for(const eye of selected){
 // Each original column provides its own fur shade just above the eye. Only
 // the eye silhouette is redrawn, never shifted/scaled from another frame.
 for(let x=eye.left;x<eye.left+eye.width;x++){
  const column=eye.pixels.filter(p=>p[0]===x).map(p=>p[1]);if(!column.length)continue;
  const top=Math.min(...column),bottom=Math.max(...column),fur=original.subarray(((top-1)*240+x)*4,((top-1)*240+x)*4+3);
  const lidColor=original.subarray((top*240+x)*4,(top*240+x)*4+3);
  for(let phase=1;phase<=2;phase++){
   const coverBottom=phase===1?Math.floor((top+bottom)/2):bottom;
   for(let y=top;y<=coverBottom;y++)fur.copy(poses[phase],(y*240+x)*4);
   const lidY=phase===1?coverBottom:Math.min(bottom,Math.round((top+bottom)/2)+1);
   lidColor.copy(poses[phase],(lidY*240+x)*4);
  }
 }
}
for(let i=0;i<3;i++)await sharp(poses[i],{raw:{width:240,height:128,channels:4}}).png().toFile(path.join(output,`pose-${i}.png`));
const panels=await Promise.all(poses.map(async(p,i)=>({input:await sharp(p,{raw:{width:240,height:128,channels:4}}).png().toBuffer(),left:i*240,top:0})));
const strip=await sharp({create:{width:720,height:128,channels:4,background:'#222'}}).composite(panels).png().toBuffer();await sharp(strip).resize(1440,256,{kernel:'nearest'}).toFile(path.join(output,'poses.png'));
await fs.writeFile(path.join(output,'index.html'),`<!doctype html><meta charset=utf-8><style>body{background:#222;color:white;font:16px system-ui}img{image-rendering:pixelated}</style><h1>Source-bound eyelids — ${process.env.BLINK_IDS?'manual selection control':'AI-selected source IDs'}</h1><img id=p width=720 src=pose-0.png><p>Original / half-closed / closed</p><img src=poses.png width=1440><script>let i=0;const seq=[0,0,0,0,0,1,2,1];setInterval(()=>p.src='pose-'+seq[++i%8]+'.png',180)</script>`);
console.log(JSON.stringify({selected:ids,changed:poses.map(p=>{let n=0;for(let i=0;i<p.length;i+=4)if(!p.subarray(i,i+4).equals(original.subarray(i,i+4)))n++;return n;})}));
// Compile into the real existing CBA/document contract, retaining source assets.
const sequence=[0,0,0,0,0,1,2,1];
const palette=[...new Set(Array.from({length:original.length/4},(_,i)=>'#'+original.subarray(i*4,i*4+3).toString('hex').toUpperCase()))];
if(palette.length>26)throw Error('This fixture must use the actual export palette');
const lines=['CBA1',`${rw} ${rh} 8 4`,String(palette.length),...palette];
for(const index of sequence)for(let y=ry;y<ry+rh;y++){
 let encoded='',last='',n=0;
 for(let x=rx;x<rx+rw;x++){const p=poses[index],hex='#'+p.subarray((y*240+x)*4,(y*240+x)*4+3).toString('hex').toUpperCase(),token=String.fromCharCode(97+palette.indexOf(hex));if(token===last)n++;else{if(n)encoded+=(n===1?'':n)+last;last=token;n=1;}}
 if(n)encoded+=(n===1?'':n)+last;lines.push(encoded);
}
const next=structuredClone(design);next.assets[region.assetPath]={contentType:'text/plain',encoding:'text',data:lines.join('\n')+'\n'};
let primitive=next.spec.primitives.find(p=>p.assetPath===region.assetPath);
if(!primitive){primitive={type:'sprite',...region};next.spec.primitives.splice(1,0,primitive);}
Object.assign(primitive,{frameCount:8,fps:4,sheetColumns:8});
await fs.writeFile(path.join(output,'design.json'),JSON.stringify(next));
const sheet=await sharp({create:{width:rw*4,height:rh*2,channels:4,background:'#000'}}).composite(await Promise.all(sequence.map(async(p,i)=>({input:await sharp(poses[p],{raw:{width:240,height:128,channels:4}}).extract({left:rx,top:ry,width:rw,height:rh}).png().toBuffer(),left:i%4*rw,top:Math.floor(i/4)*rh})))).png().toBuffer();
const compiled={imageBase64:(await fs.readFile(imageFile)).toString('base64'),imageContentType:'image/png',style:{packName:design.packName,title:'Source-bound blink',notes:'I simplified the movement to a subtle blink, keeping the original character and scene.',artPrompt:'Preserve original.',environmentPrompt:'Preserve original.',animationMode:'scene_loop',animationPrompt:'Only the selected eyes blink.',preserveArtwork:true,backgroundColor:design.spec.bgColor,panelColor:design.spec.bgColor,textColor:'#FFFFFF',sessionColor:'#FFFFFF',weeklyColor:'#FFFFFF',borderRadius:0,progressStyle:'solid'},sceneAnimation:{x:rx,y:ry,width:rw,height:rh,frameCount:8,fps:4,sheetBase64:sheet.toString('base64')}};
await fs.writeFile(path.join(output,'compiled-concept.json'),JSON.stringify(compiled));
