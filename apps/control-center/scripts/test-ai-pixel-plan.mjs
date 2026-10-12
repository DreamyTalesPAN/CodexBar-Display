// Isolated research using the already connected local planner. No key access.
// This does not modify the app or saved designs. No image generation requested.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const [designFile, imageFile, output] = process.argv.slice(2);
if(!process.env.REPLAY_PIXEL_PLAN && process.env.ALLOW_PAID_AI_TEST!=='1') throw Error('Requires explicit paid-test authorization');
const design=JSON.parse(await fs.readFile(designFile,'utf8'));
const original=await sharp(imageFile).ensureAlpha().raw().toBuffer();
const palette=[...new Set(Array.from({length:original.length/4},(_,i)=>'#'+original.subarray(i*4,i*4+3).toString('hex')))];
const moving=design.spec.primitives.find(p=>p.assetPath?.endsWith('.cba'));
let coordinateReference;
if(process.env.PIXEL_COORDINATE_GRID==='1'){
 const scale=12,margin=32,w=moving.width*scale+margin,h=moving.height*scale+margin;
 const crop=await sharp(imageFile).extract({left:moving.x,top:moving.y,width:moving.width,height:moving.height}).resize(moving.width*scale,moving.height*scale,{kernel:'nearest'}).png().toBuffer();
 let svg=`<svg width="${w}" height="${h}">`;
 for(let x=0;x<moving.width;x++)svg+=`<text x="${margin+x*scale+1}" y="24" font-family="monospace" font-size="7" fill="white">${moving.x+x}</text><path d="M${margin+x*scale} ${margin}v${h}" stroke="white" opacity=".12"/>`;
 for(let y=0;y<moving.height;y++)svg+=`<text x="2" y="${margin+y*scale+9}" font-family="monospace" font-size="8" fill="white">${moving.y+y}</text><path d="M${margin} ${margin+y*scale}h${w}" stroke="white" opacity=".12"/>`;
 svg+='</svg>';
 coordinateReference=await sharp({create:{width:w,height:h,channels:4,background:'#222'}}).composite([{input:crop,left:margin,top:margin},{input:Buffer.from(svg),left:0,top:0}]).png().toBuffer();
}
const prompt=`Keep the supplied artwork completely STATIC and unchanged: animationMode=static, preserveArtwork=true. Do NOT generate or edit an image. This is an offline pixel-animation planning experiment. In artPrompt return ONLY compact JSON {"poses":[{"runs":[[x,y,n,colorIndex]]},{"runs":[[x,y,n,colorIndex]]}]}. Each run paints n consecutive horizontal pixels at GLOBAL 240x128 coordinates with a color from the palette below. Draw a tiny physical blink of the central orange cafe cat: pose 1 half-closed eyelids, pose 2 closed eyes. Use existing fur shades to cover open-eye pixels, then draw a short curved dark lid. Do not change its head shape, body, clothing, size, location, or scenery. 1..5 pixels per run, maximum 40 painted pixels per pose, maximum 16 runs per pose. Both poses are absolute edits to the SAME original; all unspecified pixels remain EXACTLY original. Use real tiny eye details, never a pulse or moving rectangle. The cat is within x=${moving.x}..${moving.x+moving.width}, y=${moving.y}..${moving.y+moving.height}. palette=${JSON.stringify(palette)}. Keep other output fields valid and short. Notes should say what feature and exact eye coordinates you chose.`;
if(prompt.length>2000)throw Error('Prompt too long');
const style={packName:design.packName.slice(0,48),title:'Pixel study',notes:'Static source for pixel planning only.',artPrompt:'Preserve exactly.',environmentPrompt:'Preserve exactly.',animationMode:'static',animationPrompt:'',backgroundColor:'#112233',panelColor:'#112233',textColor:'#ffffff',sessionColor:'#ffffff',weeklyColor:'#ffffff',borderRadius:0,progressStyle:'solid'};
if(process.env.PIXEL_DATA_GRID==='1'){
 const left=moving.x+Math.floor(moving.width/2)-16,top=moving.y+Math.floor(moving.height/2)-12;
 style.environmentPrompt=`EXACT pixels x=${left}..${left+31}; rows labelled y. a=palette[0], b=palette[1], etc. Locate eyes from these data.\n`;
 for(let y=top;y<top+24;y++){
  let row='';for(let x=left;x<left+32;x++){const hex='#'+original.subarray((y*240+x)*4,(y*240+x)*4+3).toString('hex');row+=String.fromCharCode(97+palette.indexOf(hex));}
  style.environmentPrompt+=`${y}:${row}\n`;
 }
 if(style.environmentPrompt.length>1000)throw Error('Source grid exceeds planner context field');
}
await fs.mkdir(output,{recursive:true});
const started=Date.now();
if(coordinateReference)await fs.writeFile(path.join(output,'coordinate-reference.png'),coordinateReference);
const response=process.env.REPLAY_PIXEL_PLAN ? new Response(await fs.readFile(process.env.REPLAY_PIXEL_PLAN)) : await fetch('http://127.0.0.1:47852/v1/ai-theme/concepts',{method:'POST',headers:{Origin:'http://127.0.0.1:47852','Content-Type':'application/json'},body:JSON.stringify({target:'auto',prompt:prompt+(coordinateReference?' The reference is a coordinate-labeled magnification, NOT the whole scene. Read the pixel row/column labels to locate the actual eyes precisely; do not estimate positions from image dimensions.':''),previous:{style,imageContentType:'image/png',imageBase64:(await fs.readFile(imageFile)).toString('base64'),...(coordinateReference?{referenceImageBase64:coordinateReference.toString('base64')}: {})}})});
const result=await response.json();
await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result));
console.log(JSON.stringify({status:response.status,seconds:Math.round((Date.now()-started)/1000),style:result.style,error:result.error}));
if(!response.ok||result.style.animationMode!=='static'||!result.style.preserveArtwork)throw Error('Planner did not honor the static experiment; no further calls');
const plan=JSON.parse(result.style.artPrompt); const frames=[original];
for(const pose of plan.poses){const pixels=Buffer.from(original);let count=0;
 for(const [x,y,n,c] of pose.runs){if(![x,y,n,c].every(Number.isInteger)||x<0||y<0||x+n>240||y>=128||n<1||n>5||!palette[c]||(count+=n)>40)throw Error('Invalid bounded pixel plan');
  const color=Buffer.from(palette[c].slice(1),'hex');for(let i=0;i<n;i++)color.copy(pixels,((y*240)+x+i)*4);
 }frames.push(pixels);
}
for(let i=0;i<frames.length;i++)await sharp(frames[i],{raw:{width:240,height:128,channels:4}}).png().toFile(path.join(output,`pose-${i}.png`));
const strip=await sharp({create:{width:720,height:128,channels:4,background:'#222'}}).composite(await Promise.all(frames.map(async(b,i)=>({input:await sharp(b,{raw:{width:240,height:128,channels:4}}).png().toBuffer(),left:i*240,top:0})))).png().toBuffer();
await sharp(strip).resize(1440,256,{kernel:'nearest'}).toFile(path.join(output,'poses.png'));
await fs.writeFile(path.join(output,'index.html'),`<!doctype html><meta charset=utf-8><style>body{background:#222;color:white;font:16px system-ui}img{image-rendering:pixelated}</style><h1>AI pixel-plan experiment — not product validation</h1><img id=p width=720 src=pose-0.png><p>Original / intermediate / blink</p><img src=poses.png width=1440><script>let i=0;const sequence=[0,0,0,0,1,2,1,0];setInterval(()=>p.src='pose-'+sequence[++i%8]+'.png',200)</script>`);
