// Offline visual evidence from an exported design; no provider or credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: review-ai-theme-design.mjs design.json output-directory');
const design = JSON.parse(await fs.readFile(input, 'utf8'));
await fs.mkdir(output, {recursive:true});
function decode(asset) {
  const lines=asset.data.trim().split(/\r?\n/).filter(Boolean);
  const [width,height,count=1]=lines[1].split(/\s+/).map(Number);
  const palette=lines.slice(3,3+Number(lines[2])).map(s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16)));
  const rows=lines.slice(3+palette.length);
  const frames=[];
  for(let f=0;f<count;f++) {
    const pixels=Buffer.alloc(width*height*4);
    for(let y=0;y<height;y++) {
      let x=0;
      for(const match of rows[f*height+y].matchAll(/(\d*)([a-z.])/g)) {
        const n=Number(match[1]||1), rgb=palette[match[2].charCodeAt(0)-97];
        for(let j=0;j<n;j++,x++) if(rgb) pixels.set([...rgb,255],(y*width+x)*4);
      }
      if(x!==width) throw Error('Invalid row width');
    }
    frames.push(pixels);
  }
  return {width,height,frames};
}
const bgPrimitive=design.spec.primitives.find(p=>p.assetPath?.endsWith('ai-screen.cbi'));
const moving=design.spec.primitives.find(p=>p.assetPath?.endsWith('.cba'));
const bg=decode(design.assets[bgPrimitive.assetPath]);
const animation=moving?decode(design.assets[moving.assetPath]):null;
const count=animation?.frames.length||1;
const panels=[];
for(let f=0;f<count;f++) {
  let img=sharp(bg.frames[0],{raw:{width:bg.width,height:bg.height,channels:4}});
  if(animation) img=img.composite([{input:animation.frames[f],raw:{width:animation.width,height:animation.height,channels:4},left:moving.x,top:moving.y}]);
  const png=await img.png().toBuffer();
  await fs.writeFile(path.join(output,`frame-${f}.png`),png);
  panels.push({input:png,left:f*bg.width,top:0});
}
const strip=await sharp({create:{width:bg.width*count,height:bg.height,channels:4,background:'#ffffff'}}).composite(panels).png().toBuffer();
await sharp(strip).resize(bg.width*count*2,bg.height*2,{kernel:'nearest'}).png().toFile(path.join(output,'frames.png'));
await fs.writeFile(path.join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>Animation review</title><style>body{background:#222;color:white;font:16px system-ui}img{image-rendering:pixelated}#loop{width:720px;height:384px}</style><h1>Exported animation — unchanged original</h1><img id="loop" src="frame-0.png"><p>All ${count} original frames:</p><img width="${bg.width*count}" src="frames.png"><script>let f=0;setInterval(()=>document.querySelector('#loop').src='frame-'+(++f%${count})+'.png',${1000/(moving?.fps||4)});</script>`);
console.log(JSON.stringify({output,count,region:moving?{x:moving.x,y:moving.y,width:moving.width,height:moving.height}:null}));
