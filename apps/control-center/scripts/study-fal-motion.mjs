// Two bounded video experiments. Key remains server-side and is never logged.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const [out,mode='submit']=process.argv.slice(2);
const env=await fs.readFile('/Users/marcushaas/.codex/secrets/fal.env','utf8');
const match=env.match(/^(?:export\s+)?FAL_KEY\s*=\s*(.+)$/m);
if(!match)throw Error('FAL_KEY is not configured');
const key=match[1].trim().replace(/^['"]|['"]$/g,'');
const headers={Authorization:`Key ${key}`,'Content-Type':'application/json'};
const endpoint='fal-ai/kling-video/v2.1/standard/image-to-video';
for(const kind of ['robot','cat']){
 const dir=path.join(out,kind),file=path.join(dir,'fal-request.json');
 if(mode==='submit'){
  try{await fs.access(file);console.log({kind,status:'already submitted; no duplicate'});continue;}catch{}
  const prompt=kind==='robot'?'Locked camera. The blue robot raises its right arm, waves its hand twice, then lowers it to its original resting position. Only its arm moves. The robot feet, body, face, plant, window, and background are completely still. Retain exact flat pixel-art character design and proportions. Smooth deliberate 5 second complete action, ending in starting pose.':'Locked camera. The orange cat lifts the cream cup in its right paw to its mouth, takes one sip, then lowers the same cup back to its original resting position. Keep the cup attached to the paw. Only the arm and cup move. Body, head, feet and all background stay still. Retain exact flat pixel-art character design. Smooth 5 second complete action ending in starting pose.';
  const image=await sharp(path.join(dir,'source.png')).resize(960,512,{kernel:'nearest'}).png().toBuffer();
  const response=await fetch(`https://queue.fal.run/${endpoint}`,{method:'POST',headers,body:JSON.stringify({prompt,image_url:`data:image/png;base64,${image.toString('base64')}`,duration:'5',negative_prompt:'camera movement, zoom, changing identity, deformation, morphing, extra limbs, moving background, text',cfg_scale:0.5})});
  if(!response.ok)throw Error(`Submit HTTP ${response.status}; no automatic retry`);
  const result=await response.json();await fs.writeFile(file,JSON.stringify({...result,endpoint,duration:5,documentedEstimateUSD:0.28,prompt}));console.log({kind,requestId:result.request_id,status:'submitted',estimatedUSD:0.28});
 }else{
  const request=JSON.parse(await fs.readFile(file));
  const status=await fetch(request.status_url,{headers});if(!status.ok)throw Error(`Status HTTP ${status.status}`);const state=await status.json();console.log({kind,status:state.status});
  if(state.status!=='COMPLETED')continue;
  try{await fs.access(path.join(dir,'motion.mp4'));continue;}catch{}
  const response=await fetch(request.response_url,{headers});if(!response.ok)throw Error(`Result HTTP ${response.status}`);const result=await response.json();
  if(!result.video?.url)throw Error('No video in completed result');
  // Download is necessary input for local motion extraction, not a display workaround.
  const video=await fetch(result.video.url);if(!video.ok)throw Error(`Video HTTP ${video.status}`);
  await fs.writeFile(path.join(dir,'motion.mp4'),Buffer.from(await video.arrayBuffer()));
  await fs.writeFile(path.join(dir,'fal-result.json'),JSON.stringify({requestId:request.request_id,contentType:result.video.content_type,fileSize:result.video.file_size,downloaded:true}));
 }
}
