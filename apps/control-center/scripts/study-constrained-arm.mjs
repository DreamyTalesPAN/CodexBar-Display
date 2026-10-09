// Control: retain AI-selected sip target; solve the unsafe intermediate path.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {draw,solve} from './study-animation-rigs.mjs';
const [root]=process.argv.slice(2),dir=path.join(root,'cat'),out=path.join(dir,'constrained');
await fs.mkdir(out,{recursive:true});
const plan=JSON.parse(await fs.readFile(path.join(dir,'plan.json')));
const holdIndex=plan.keys.findIndex((k,i,a)=>i>0&&k.w[0]===a[i-1].w[0]&&k.w[1]===a[i-1].w[1]);
assert(holdIndex>0,'AI plan must contain an explicit hold');
const start=[20,10],goal=plan.keys[holdIndex].w,holdStart=plan.keys[holdIndex-1].t,holdEnd=plan.keys[holdIndex].t;
// These are fixture-authored anatomy constraints, not inferred segmentation.
const safe=w=>{try{const e=solve(w,-1);return w[1]>=-7&&w[0]>=-24&&w[0]<=29&&w[1]<=29&&e[1]>=-7;}catch{return false;}};
assert(safe(start)&&safe(goal));
assert(plan.keys.some(k=>!safe(k.w)),'Baseline must actually violate the new constraint');
const id=p=>p.join(','),front=[start],seen=new Map([[id(start),null]]);
while(front.length&&!seen.has(id(goal))){const p=front.shift();for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){const q=p.map((v,i)=>v+d[i]);if(!safe(q)||seen.has(id(q)))continue;seen.set(id(q),p);front.push(q);}}
assert(seen.has(id(goal)),'No reachable safe path; do not invent a successful pose');
const route=[];for(let p=goal;p;p=seen.get(id(p)))route.unshift(p);
const trajectory=[];
for(let i=0;i<24;i++){
 const t=i/23,phase=t<holdStart?t/holdStart:t<holdEnd?1:(1-t)/(1-holdEnd),u=phase*phase*(3-2*phase),r=u*(route.length-1),a=Math.floor(r),b=Math.min(route.length-1,a+1),q=r-a;
 const w=route[a].map((v,j)=>v+(route[b][j]-v)*q);assert(safe(w));trajectory.push(w);
 const png=await sharp(Buffer.from(draw('cat',w,-1))).png().toBuffer();await fs.writeFile(path.join(out,`frame-${i}.png`),png);
}
await fs.writeFile(path.join(dir,'trajectory-constrained.json'),JSON.stringify(trajectory));
await fs.writeFile(path.join(out,'report.json'),JSON.stringify({targetFromAI:goal,fixtureConstraints:{minimumWristY:-7,minimumElbowY:-7},route,baselineUnsafe:plan.keys.filter(k=>!safe(k.w)).length,verifiedFrames:trajectory.length},null,2));
console.log({baselineUnsafe:plan.keys.filter(k=>!safe(k.w)).length,routeNodes:route.length,targetFromAI:goal,verifiedFrames:trajectory.length});
