// Explicit paid research fixture; no credential readback or browser writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const [output,prompt]=process.argv.slice(2);
if(process.env.ALLOW_PAID_AI_TEST!=='1')throw Error('Explicit paid-test opt-in required');
await fs.mkdir(output,{recursive:true});
const start=Date.now();
const r=await fetch('http://127.0.0.1:47852/v1/ai-theme/concepts',{method:'POST',headers:{Origin:'http://127.0.0.1:47852','Content-Type':'application/json'},body:JSON.stringify({target:'auto',prompt})});
const result=await r.json();await fs.writeFile(path.join(output,'provider.json'),JSON.stringify(result));
console.log(JSON.stringify({status:r.status,seconds:(Date.now()-start)/1000,style:result.style,error:result.error}));
if(!r.ok||result.style?.animationMode!=='static')throw Error('Fixture failed; no retry');
await sharp(Buffer.from(result.imageBase64,'base64')).resize(240,128,{fit:'fill',kernel:'nearest'}).png().toFile(path.join(output,'source.png'));
