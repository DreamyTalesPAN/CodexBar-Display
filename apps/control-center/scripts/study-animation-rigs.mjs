// Isolated research fixtures, not automatic decomposition of customer artwork.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
const N=24;
export function solve(w,branch=1){
 const r=Math.hypot(...w),l=16;
 if(r>31.9||r<3)throw Error('Unreachable wrist');
 const a=Math.atan2(w[1],w[0])+branch*Math.acos(r/(2*l));
 return [l*Math.cos(a),l*Math.sin(a)];
}
export function draw(kind,w,branch=1){
 const cat=kind==='cat',c=cat?'#efab58':'#56a8e8',dark='#192b42',s=[132,69],e=solve(w,branch),hand=[s[0]+w[0],s[1]+w[1]],el=[s[0]+e[0],s[1]+e[1]];
 const body=cat?`<path d="M106 43L103 27L117 36L125 36L138 27L137 46Z" fill="${c}" stroke="${dark}" stroke-width="2"/><ellipse cx="121" cy="47" rx="18" ry="15" fill="${c}" stroke="${dark}" stroke-width="2"/>`:`<rect x="102" y="30" width="38" height="30" rx="7" fill="${c}" stroke="${dark}" stroke-width="2"/><path d="M121 30V23" stroke="${c}" stroke-width="3"/><circle cx="121" cy="22" r="3" fill="#d5edfa"/>`;
 const cup=cat?`<path d="M${hand[0]+4} ${hand[1]-7}h5v7h-5" fill="none" stroke="#f9e6c6" stroke-width="3"/><rect x="${hand[0]-7}" y="${hand[1]-10}" width="12" height="14" rx="2" fill="#f9e6c6" stroke="${dark}" stroke-width="1"/><path d="M${hand[0]-5} ${hand[1]-8}h8" stroke="#7d4e31" stroke-width="2"/>`:'';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="128" viewBox="0 0 240 128"><rect width="240" height="128" fill="#121c32"/><rect x="14" y="13" width="60" height="56" fill="#243952"/><path d="M44 13V69M14 41H74" stroke="#101c2d" stroke-width="3"/><circle cx="59" cy="26" r="7" fill="#8da9bf"/><rect x="0" y="108" width="240" height="20" fill="#38495b"/><rect x="174" y="88" width="18" height="19" fill="#526d64"/><path d="M183 88V66M183 78L174 72M183 73L192 64" stroke="#749b83" stroke-width="3"/><ellipse cx="121" cy="106" rx="26" ry="3" fill="#101c2d"/><path d="M110 91V103H104M131 91V103H137" stroke="${dark}" stroke-width="9"/><path d="M110 91V103H104M131 91V103H137" stroke="${c}" stroke-width="5"/><rect x="109" y="59" width="25" height="34" rx="7" fill="${c}" stroke="${dark}" stroke-width="2"/>${cat?'<path d="M113 63H130V91H113Z" fill="#59848a"/>':'<rect x="115" y="67" width="12" height="13" rx="2" fill="#1c4772"/><circle cx="121" cy="72" r="2" fill="#cef2ff"/>'}<path d="M110 68L101 81L104 89" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/><path d="M110 68L101 81L104 89" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>${body}<ellipse cx="114" cy="45" rx="3" ry="4" fill="${dark}"/><ellipse cx="129" cy="45" rx="3" ry="4" fill="${dark}"/><path d="M117 53Q121 56 126 52" fill="none" stroke="${dark}" stroke-width="1.5"/><path d="M${s}L${el}L${hand}" fill="none" stroke="${dark}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M${s}L${el}L${hand}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${el[0]}" cy="${el[1]}" r="3" fill="${dark}"/>${cup}<circle cx="${hand[0]}" cy="${hand[1]}" r="3" fill="${cat?c:'#b2e7ff'}" stroke="${dark}" stroke-width="1"/></svg>`;
}
const wristAt=(keys,t)=>{let j=keys.findIndex(k=>k.t>t);if(j<0)return keys.at(-1).w;const a=keys[j-1],b=keys[j],q=(t-a.t)/(b.t-a.t),u=q*q*(3-2*q);return a.w.map((v,i)=>v+(b.w[i]-v)*u);};
if(process.argv[1]===fileURLToPath(import.meta.url)){
const [out,mode='plan']=process.argv.slice(2);
if(!out)throw Error('Output directory required');
await fs.mkdir(out,{recursive:true});
for(const kind of ['robot','cat']){
 const dir=path.join(out,kind);await fs.mkdir(dir,{recursive:true});
 const rest=[20,10];
 try{await fs.access(path.join(dir,'source.png'));}catch{await sharp(Buffer.from(draw(kind,rest))).png().toFile(path.join(dir,'source.png'));}
 if(mode==='source')continue;
 let plan;
 if(mode==='plan'){
  const style={packName:'Rig study',title:'Rig study',notes:'Planning only',artPrompt:'Keep artwork.',environmentPrompt:'Research fixture, two arm segments 16 pixels each. Shoulder [132,69]. Coordinate x right, y down.',animationMode:'static',animationPrompt:'',preserveArtwork:true,backgroundColor:'#121c32',panelColor:'#121c32',textColor:'#ffffff',sessionColor:'#ffffff',weeklyColor:'#ffffff',borderRadius:0,progressStyle:'solid'};
  const action=kind==='robot'?'Robot raises its right wrist above its shoulder, waves sideways twice with clear pauses, lowers back. Head/body stay still.':'Cat holds a cup attached to its wrist. Raise cup to mouth, pause to sip, then lower it. Mouth is [-11,-16] relative to shoulder; cup lip is [0,-9] relative to wrist, so sipping wrist target is [-11,-7].';
  const prompt=`Keep animationMode=static and preserveArtwork=true. Do not generate any image. Return ONLY JSON in artPrompt: {"keys":[{"t":0,"w":[20,10]},...,{"t":1,"w":[20,10]}]}. Plan 7 to 12 keyframes for ${action} w is wrist RELATIVE to shoulder in pixels. Every w must have radius 4..31; x -24..28, y -28..25. Use times strictly increasing from 0 to 1. Start AND end exactly [20,10]. Movement is drawn by a two-bone IK rig, do not translate whole figure. Notes describe the action. No markdown.`;
  const start=Date.now(),res=await fetch('http://127.0.0.1:47852/v1/ai-theme/concepts',{method:'POST',headers:{Origin:'http://127.0.0.1:47852','Content-Type':'application/json'},body:JSON.stringify({target:'auto',prompt,previous:{style,imageContentType:'image/png',imageBase64:(await fs.readFile(path.join(dir,'source.png'))).toString('base64')}})});
  const result=await res.json();await fs.writeFile(path.join(dir,'provider.json'),JSON.stringify(result));
  if(!res.ok||result.style?.animationMode!=='static'||!result.style.preserveArtwork)throw Error('Planner failed, no automatic retry');
  plan=JSON.parse(result.style.artPrompt);await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(plan));console.log({kind,seconds:(Date.now()-start)/1000,plan});
 }else plan=JSON.parse(await fs.readFile(path.join(dir,'plan.json')));
 const keys=plan.keys;if(!Array.isArray(keys)||keys.length<3||keys[0].t!==0||keys.at(-1).t!==1||JSON.stringify(keys[0].w)!==JSON.stringify(rest)||JSON.stringify(keys.at(-1).w)!==JSON.stringify(rest))throw Error('Invalid endpoints');
 keys.forEach((k,i)=>{if(!Number.isFinite(k.t)||(i&&k.t<=keys[i-1].t)||!Array.isArray(k.w)||k.w.length!==2||k.w.some(v=>!Number.isFinite(v)))throw Error('Invalid key');solve(k.w);});
 const frames=[],trajectory=[];
 for(let i=0;i<N;i++){const w=wristAt(keys,i/(N-1));solve(w);trajectory.push(w);const png=await sharp(Buffer.from(draw(kind,w))).png().toBuffer();frames.push(png);await fs.writeFile(path.join(dir,`frame-${i}.png`),png);}
 await fs.writeFile(path.join(dir,'trajectory.json'),JSON.stringify(trajectory));
 await sharp({create:{width:240*6,height:128*4,channels:4,background:'#121c32'}}).composite(frames.map((input,i)=>({input,left:i%6*240,top:Math.floor(i/6)*128}))).png().toFile(path.join(dir,'sheet.png'));
}
}
