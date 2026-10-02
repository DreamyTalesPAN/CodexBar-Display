// Research: real generated background + independent keyed sprite sheets.
// Uses the existing local text planner for placement, not an AI quality judge.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const [out,mode='prepare']=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const generated='/Users/marcushaas/.codex/generated_images/01a08b70-1469-7861-b090-2534062275da';
const inputs={background:'exec-b5421a85-4750-46e1-8fee-3569537957b6.png',fox:'exec-66099a5c-dd47-4e9a-9c28-06cfd8404bce.png',bird:'exec-d733de5b-96d5-4097-a77f-effe78f7f762.png'};
const rgba=(file)=>sharp(file).ensureAlpha().raw().toBuffer();
function decode(data){
 const lines=data.trim().split('\n'),[w,h,n=1]=lines[1].split(' ').map(Number),palette=lines.slice(3,3+Number(lines[2])).map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16))),rows=lines.slice(3+palette.length),frames=[];
 for(let f=0;f<n;f++){const p=Buffer.alloc(w*h*4);for(let y=0;y<h;y++){let x=0;for(const m of rows[f*h+y].matchAll(/(\d*)([a-z.])/g)){const count=Number(m[1]||1),c=palette[m[2].charCodeAt(0)-97];for(let j=0;j<count;j++,x++)if(c)p.set([...c,255],(y*w+x)*4);}assert.equal(x,w);}frames.push(p);}return frames;
}
function keyPixels(p){for(let i=0;i<p.length;i+=4){const r=p[i],g=p[i+1],b=p[i+2];if(r>120&&b>120&&g<130&&Math.min(r,b)-g>65){p[i]=p[i+1]=p[i+2]=p[i+3]=0;}}return p;}
if(mode==='prepare'){
 for(const [id,file] of Object.entries(inputs))await fs.copyFile(path.join(generated,file),path.join(out,`${id}-source.png`));
 await sharp(path.join(out,'background-source.png')).resize(240,128,{fit:'fill',kernel:'nearest'}).png({palette:true,colours:26,dither:0}).toFile(path.join(out,'background.png'));
 const normalization={};
 for(const id of ['fox','bird']){
  const dir=path.join(out,id);await fs.mkdir(dir,{recursive:true});
  const input=path.join(out,`${id}-source.png`),meta=await sharp(input).metadata(),frames=[];
  for(let i=0;i<8;i++){
   const x=Math.round((i%4)*meta.width/4),y=Math.round(Math.floor(i/4)*meta.height/2),w=Math.round((i%4+1)*meta.width/4)-x,h=Math.round((Math.floor(i/4)+1)*meta.height/2)-y;
   const p=keyPixels(await sharp(input).extract({left:x,top:y,width:w,height:h}).ensureAlpha().raw().toBuffer());
   frames.push(await sharp(p,{raw:{width:w,height:h,channels:4}}).resize(80,80,{kernel:'nearest'}).raw().toBuffer());
  }
  // A shared scale, translation-only registration to the first pose. No per-frame
  // zoom, redrawing, elastic warp, skeletal rig, or synthetic body motion.
  const shifts=[],registered=[];
  for(const [n,p] of frames.entries()){
   let best={score:Infinity,dx:0,dy:0};
   for(let dy=-10;dy<=10;dy++)for(let dx=-10;dx<=10;dx++){
    let score=0,count=0;
    for(let y=4;y<76;y+=2)for(let x=4;x<76;x+=2){const a=(y*80+x)*4;if(frames[0][a+3]<128)continue;count++;const xx=x-dx,yy=y-dy,b=(yy*80+xx)*4;
     if(xx<0||xx>=80||yy<0||yy>=80||p[b+3]<128){score+=1;continue;}
     score+=Math.min(1,([0,1,2].reduce((s,j)=>s+(frames[0][a+j]-p[b+j])**2,0))/24000);
    }
    score=score/count+0.0001*(dx*dx+dy*dy);if(score<best.score)best={score,dx,dy};
   }
   if(n===0)best={score:0,dx:0,dy:0};
   const q=Buffer.alloc(80*80*4);let clipped=0;
   for(let y=0;y<80;y++)for(let x=0;x<80;x++){const a=(y*80+x)*4;if(!p[a+3])continue;const xx=x+best.dx,yy=y+best.dy;if(xx<0||xx>=80||yy<0||yy>=80){clipped++;continue;}p.copy(q,(yy*80+xx)*4,a,a+4);}
   assert.equal(clipped,0,'Registration would clip sprite');registered.push(q);shifts.push(best);
  }
  for(let i=0;i<8;i++)await sharp(registered[i],{raw:{width:80,height:80,channels:4}}).png().toFile(path.join(dir,`master-${i}.png`));
  normalization[id]={sourceHasAlpha:meta.hasAlpha,frameCount:8,shifts};
 }
 await fs.writeFile(path.join(out,'normalization.json'),JSON.stringify(normalization,null,2));console.log(normalization);
}
if(mode==='plan'){
 const style={packName:'Woodland companions',title:'Woodland pets',notes:'Placement only',artPrompt:'Keep image.',environmentPrompt:'240x128 woodland glade, fixed background. Transparent fox and bird are separate topmost sprites.',animationMode:'static',animationPrompt:'',preserveArtwork:true,backgroundColor:'#172C32',panelColor:'#172C32',textColor:'#FFFFFF',sessionColor:'#FFBC69',weeklyColor:'#8FBDBC',borderRadius:0,progressStyle:'solid'};
 const prompt='Keep animationMode=static and preserveArtwork=true. Do not generate or change images. Plan tasteful placement of separate foreground companion sprites on this EXACT 240x128 background. In artPrompt return ONLY JSON {"one":[{"id":"fox","x":integer,"y":integer,"size":integer}],"two":[{"id":"fox","x":integer,"y":integer,"size":integer},{"id":"bird","x":integer,"y":integer,"size":integer}]}. x,y are TOP LEFT of a square sprite canvas. Fox size 36..48, its feet are at 0.88*size below its top edge and should touch clear grass/path around y90..107. Bird size 24..32, flying above/to one side of the fox. Keep the sprites completely inside artwork and separate without overlap. Avoid covering trees, rocks or the sunset; use the open clearing. Both inherit the warm upper-left light. The one-sprite composition should be balanced on its own. Notes briefly explain placement. No markdown.';
 const start=Date.now(),r=await fetch('http://127.0.0.1:47852/v1/ai-theme/concepts',{method:'POST',headers:{Origin:'http://127.0.0.1:47852','Content-Type':'application/json'},body:JSON.stringify({target:'auto',prompt,previous:{style,imageContentType:'image/png',imageBase64:(await fs.readFile(path.join(out,'background.png'))).toString('base64')}})});
 const result=await r.json();await fs.writeFile(path.join(out,'placement-provider.json'),JSON.stringify(result));assert(r.ok&&result.style?.animationMode==='static'&&result.style.preserveArtwork);
 const plan=JSON.parse(result.style.artPrompt);await fs.writeFile(path.join(out,'placement.json'),JSON.stringify(plan,null,2));console.log({seconds:(Date.now()-start)/1000,plan,notes:result.style.notes});
}
if(mode==='render'){
 const plan=JSON.parse(await fs.readFile(path.join(out,'placement.json'))),bg=await rgba(path.join(out,'background.png'));
 const source=JSON.parse(await fs.readFile(path.join(out,'..','current-generated.json')));
 const encode=(buffers,w,h,fps)=>{
  const colors=new Map();for(const p of buffers)for(let i=0;i<p.length;i+=4)if(p[i+3]>=128){const c='#'+p.subarray(i,i+3).toString('hex').toUpperCase();colors.set(c,(colors.get(c)||0)+1);}
  const palette=[...colors].sort((a,b)=>b[1]-a[1]).slice(0,26).map(x=>x[0]),rgb=palette.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
  const rows=[];for(const p of buffers)for(let y=0;y<h;y++){
   let line='',last='',count=0;for(let x=0;x<w;x++){const i=(y*w+x)*4;let token='.';
    if(p[i+3]>=128){let best=Infinity,index=0;for(let j=0;j<rgb.length;j++){const d=rgb[j].reduce((s,v,k)=>s+(v-p[i+k])**2,0);if(d<best){best=d;index=j;}}token=String.fromCharCode(97+index);}
    if(token===last)count++;else{if(count)line+=(count===1?'':count)+last;last=token;count=1;}
   }if(count)line+=(count===1?'':count)+last;rows.push(line);
  }return [(fps?'CBA1':'CBI1'),fps?`${w} ${h} ${buffers.length} ${fps}`:`${w} ${h}`,String(palette.length),...palette,...rows,''].join('\n');
 };
 const report={};
 for(const name of ['one','two']){
  const placements=plan[name];assert.equal(placements.length,name==='one'?1:2);
  const assets={'/themes/u/pet-background.cbi':{contentType:'text/plain',encoding:'text',data:encode([bg],240,128)}};
  const sprites=[],prepared=[];const dir=path.join(out,name);await fs.mkdir(dir,{recursive:true});
  for(const p of placements){assert(['fox','bird'].includes(p.id)&&[p.x,p.y,p.size].every(Number.isInteger)&&p.size>=24&&p.size<=48&&p.x>=0&&p.y>=0&&p.x+p.size<=240&&p.y+p.size<=128);
   const frames=[];for(let i=0;i<8;i++){
    const png=await sharp(path.join(out,p.id,`master-${i}.png`)).resize(p.size,p.size,{kernel:'nearest'}).png({palette:true,colours:26,dither:0}).toBuffer();frames.push(await rgba(png));await fs.writeFile(path.join(dir,`${p.id}-${i}.png`),png);
   }
   const assetPath=`/themes/u/pet-${p.id}.cba`;assets[assetPath]={contentType:'text/plain',encoding:'text',data:encode(frames,p.size,p.size,p.id==='bird'?8:4)};
   const encodedFrames=decode(assets[assetPath].data);
   for(let i=0;i<8;i++)await sharp(encodedFrames[i],{raw:{width:p.size,height:p.size,channels:4}}).png().toFile(path.join(dir,`${p.id}-${i}.png`));
   sprites.push({type:'sprite',assetPath,x:p.x,y:p.y,width:p.size,height:p.size,frameCount:8,fps:p.id==='bird'?8:4,sheetColumns:8});prepared.push({p,frames:encodedFrames});
  }
  if(sprites.length===2){const[a,b]=sprites;assert(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Sprite overlap');}
  const outputs=[];let outside=0;
  for(let t=0;t<16;t++){
   const frame=Buffer.from(bg);for(const {p,frames}of prepared){const f=frames[p.id==='bird'?t%8:Math.floor(t/2)%8];for(let y=0;y<p.size;y++)for(let x=0;x<p.size;x++){const i=(y*p.size+x)*4;if(f[i+3]>=128)f.copy(frame,((p.y+y)*240+p.x+x)*4,i,i+4);}}
   for(let y=0;y<128;y++)for(let x=0;x<240;x++){const i=(y*240+x)*4;if(!frame.subarray(i,i+4).equals(bg.subarray(i,i+4))&&!sprites.some(p=>x>=p.x&&x<p.x+p.width&&y>=p.y&&y<p.y+p.height))outside++;}
   const png=await sharp(frame,{raw:{width:240,height:128,channels:4}}).png().toBuffer();outputs.push(png);await fs.writeFile(path.join(dir,`frame-${t}.png`),png);
  }
  assert.equal(outside,0);assert(new Set(outputs.map(b=>b.toString('base64'))).size>3);
  const design={...source,packName:name==='one'?'Woodland Fox':'Woodland Companions',assets,spec:{...source.spec,primitives:[{type:'sprite',assetPath:'/themes/u/pet-background.cbi',x:0,y:0,width:240,height:128},...sprites,...source.spec.primitives.filter(p=>!p.assetPath)]}};
  await fs.writeFile(path.join(dir,'design.json'),JSON.stringify(design));
  await sharp({create:{width:960,height:128,channels:4,background:'#000'}}).composite([0,4,8,12].map((n,j)=>({input:outputs[n],left:j*240,top:0}))).png().toFile(path.join(dir,'contact.png'));
  report[name]={sprites,backgroundChangesOutsideSprites:outside,distinctFrames:new Set(outputs.map(b=>b.toString('base64'))).size};
 }
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(report);
}
