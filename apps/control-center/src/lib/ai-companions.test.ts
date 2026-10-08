import {describe,it,expect,vi} from "vitest";
import {buildAIThemeCompanionCandidateFromRGBA,buildAIThemeCandidateFromRGBA,AI_THEME_SCREENMASTER_ASSET_PATH as ART,type AIThemeConcept} from "./ai-theme";
import {applyAIThemeCandidate,conceptFromDocument} from "./ai-theme-document";
import {registerCompanionFrames} from "./ai-companion-sprites";
import {decodeSprite} from "@/components/live-vibetv-preview";
import {buildThemePack,validateThemeSpec} from "./theme-studio";
import {createThemeStudioEditorState,themeStudioEditorReducer} from "@/components/theme-studio/theme-studio-editor-state";

const base: AIThemeConcept={imageBase64:"fixture",imageContentType:"image/png",companions:[],style:{packName:"Forest",title:"Forest",notes:"Companions",artPrompt:"Fox",environmentPrompt:"Forest",animationMode:"four_frame",animationPrompt:"Swish",backgroundColor:"#112233",panelColor:"#112233",textColor:"#FFFFFF",sessionColor:"#FFFFFF",weeklyColor:"#FFFFFF",borderRadius:0,progressStyle:"solid"}};
const background=new Uint8ClampedArray(240*128*4).fill(255);
function fixture(n=2){
 const concept:AIThemeConcept={...base,companions:Array.from({length:n},(_,i)=>({id:i===0?"pet-1":"pet-2",x:20+i*70,y:40,size:32,fps:4,frameCount:8,keyColor:"#FF00FF",sheetBase64:"fixture",reuse:false}))};
 const frames=concept.companions!.map(()=>Array.from({length:8},(_,i)=>{const p=new Uint8ClampedArray(32*32*4);p.set([255,i*17,0,255],(10*32+10+i)*4);return p;}));
 return {concept,frames,candidate:()=>buildAIThemeCompanionCandidateFromRGBA(concept,background,frames)};
}
describe("one/two independent AI companions",()=>{
 it('keeps source animation within 64px while rendering an 80px companion',()=>{
  const f=fixture(1);Object.assign(f.concept.companions![0],{size:80,x:56,y:0});
  const frames=[Array.from({length:8},()=>{const p=new Uint8ClampedArray(64*64*4);p.set([255,100,0,255],(20*64+20)*4);return p;})];
  const c=buildAIThemeCompanionCandidateFromRGBA(f.concept,background,frames);
  expect(c.spec.primitives.find(p=>p.assetPath==='/themes/u/ai-pet-1.cba')).toMatchObject({width:80,height:80});
  expect(decodeSprite(c.assets['/themes/u/ai-pet-1.cba'].data)?.width).toBe(64);
  expect(validateThemeSpec(c.spec,c.assets).errors).toEqual([]);
 });
 it('supports a paused 64px companion when regenerating only its background',()=>{
  const f=fixture(1);Object.assign(f.concept.companions![0],{size:64,fps:0,reuse:true});
  const frames=[Array.from({length:8},()=>{const p=new Uint8ClampedArray(64*64*4);p.set([255,100,0,255],(20*64+20)*4);return p;})];
  const c=buildAIThemeCompanionCandidateFromRGBA(f.concept,background,frames);
  expect(decodeSprite(c.assets['/themes/u/ai-pet-1.cba'].data)?.fps).toBe(0);
  expect(validateThemeSpec(c.spec,c.assets).errors).toEqual([]);
 });
 it.each([0,1,2])("compiles %i sprites over exactly one static background",n=>{
  const c=fixture(n).candidate();expect(c.spec.primitives.filter(p=>p.assetPath)).toHaveLength(n+1);
  expect(c.assets[ART]).toEqual(buildAIThemeCandidateFromRGBA(base,background).assets[ART]);
  for(const p of c.spec.primitives.filter(p=>p.assetPath?.endsWith('.cba'))){const s=decodeSprite(c.assets[p.assetPath!].data)!;expect(s.frames).toHaveLength(8);expect(c.assets[p.assetPath!].data).toContain('.');}
  expect(validateThemeSpec(c.spec,c.assets).errors).toEqual([]);expect(()=>buildThemePack(c.spec,c.packName,c.assets)).not.toThrow();
 });
 it("replaces managed layers, keeps manual edits, removes the second sprite and supports exact Undo",()=>{
  const two=fixture().candidate(),before={...two,usage:"live" as const};before.spec.primitives.push({type:"text",x:7,y:200,text:"My label",color:"#FFFFFF"});
  const one=fixture(1).candidate(),next=applyAIThemeCandidate(before,one,"auto");
  expect(next.assets['/themes/u/ai-pet-2.cba']).toBeUndefined();expect(next.spec.primitives.at(-1)?.text).toBe('My label');
  const initial=createThemeStudioEditorState(before);
  const state=themeStudioEditorReducer(initial,{type:'update',document:next});expect(themeStudioEditorReducer(state,{type:'undo'}).present).toEqual(initial.present);
 });
 it("retains exact background and unaffected sprite bytes when requested",()=>{
  const f=fixture(),before={...f.candidate(),usage:"live" as const};f.concept.style={...f.concept.style,preserveArtwork:true};f.concept.companions![0].reuse=true;
  const incoming=f.candidate();incoming.assets[ART]={...incoming.assets[ART],data:'would repaint'};incoming.assets['/themes/u/ai-pet-1.cba']={...incoming.assets['/themes/u/ai-pet-1.cba'],data:'would redraw'};
  const next=applyAIThemeCandidate(before,incoming,'auto');expect(next.assets[ART]).toEqual(before.assets[ART]);expect(next.assets['/themes/u/ai-pet-1.cba']).toEqual(before.assets['/themes/u/ai-pet-1.cba']);
 });
 it("rejects overlap, invalid size/count and mixed legacy representations",()=>{
  const f=fixture();f.concept.companions![1].x=20;expect(f.candidate).toThrow(/overlap/);
  f.concept.companions![1].x=90;f.concept.companions![0].size=100;expect(f.candidate).toThrow();
  f.concept.companions![0].size=32;f.concept.companions!.push(f.concept.companions![0]);expect(f.candidate).toThrow();
  const g=fixture();g.concept.animation={fps:4,keyColor:'#FF00FF',spriteSheetBase64:'x'};expect(g.candidate).toThrow();
 });
 it("reconstructs both identities and positions from the current document",()=>{
  const fake={createElement:()=>({width:0,height:0,getContext:()=>({fillStyle:'',fillRect:()=>{}}),toDataURL:()=>"data:image/png;base64,fixture"})};vi.stubGlobal('document',fake);vi.stubGlobal('window',{document:fake});
  try{const c=fixture().candidate(),r=conceptFromDocument({...c,usage:'live'})!;expect(r.companions).toHaveLength(2);expect(r.animation).toBeUndefined();expect(r.companions![1]).toMatchObject({id:'pet-2',x:90,y:40,size:32,frameCount:8});}finally{vi.unstubAllGlobals();}
 });
 it("registration keeps a stable sprite unchanged and rejects empty sheets",()=>{
  const p=new Uint8ClampedArray(80*80*4);for(let y=20;y<40;y++)for(let x=20;x<40;x++)p.set([200,100,50,255],(y*80+x)*4);
  expect(registerCompanionFrames(Array.from({length:8},()=>p))).toEqual(Array.from({length:8},()=>p));expect(()=>registerCompanionFrames(Array.from({length:8},()=>new Uint8ClampedArray(p.length)))).toThrow(/empty/);
 });
});

describe("flexible picture layouts",()=>{
 const full=()=>{
  const f=fixture(1);Object.assign(f.concept,{artHeight:240,hideUsage:true});Object.assign(f.concept.companions![0],{y:190});
  return buildAIThemeCompanionCandidateFromRGBA(f.concept,new Uint8ClampedArray(240*240*4).fill(255),f.frames);
 };
 it('builds a full-screen picture without usage readouts',()=>{
  const c=full();
  expect(c.spec.primitives.map(p=>p.assetPath)).toEqual([ART,'/themes/u/ai-pet-1.cba']);
  expect(c.spec.primitives[0]).toMatchObject({x:0,y:0,width:240,height:240});
  expect(decodeSprite(c.assets[ART].data)).toMatchObject({width:240,height:240});
  expect(validateThemeSpec(c.spec,c.assets).errors).toEqual([]);
  expect(()=>buildThemePack(c.spec,c.packName,c.assets,'live')).not.toThrow();
 });
 it('draws the readouts directly on a full-screen picture and keeps companions inside the smaller one',()=>{
  const f=fixture(1);Object.assign(f.concept,{artHeight:240});
  const c=buildAIThemeCompanionCandidateFromRGBA(f.concept,new Uint8ClampedArray(240*240*4).fill(255),f.frames);
  expect(c.spec.primitives.some(p=>p.type==='rect')).toBe(false);
  expect(c.spec.primitives.some(p=>p.binding==='session')).toBe(true);
  const small=fixture(1);Object.assign(small.concept.companions![0],{y:190});
  expect(()=>small.candidate()).toThrow();
 });
 it('replaces the layout when the picture changes size and drops the readouts when a design no longer shows usage',()=>{
  const current=fixture(1).candidate();
  const document={assets:current.assets,spec:current.spec,packName:'Mine',usage:'live' as const};
  const replaced=applyAIThemeCandidate(document,full(),'auto');
  expect(replaced.packName).toBe('Mine');
  expect(replaced.spec.primitives).toHaveLength(2);
  const plain=fixture(1);Object.assign(plain.concept,{hideUsage:true});
  const kept=applyAIThemeCandidate(document,plain.candidate(),'auto');
  expect(kept.spec.primitives.some(p=>p.binding==='session'||p.text?.includes('{session}'))).toBe(false);
  expect(kept.spec.primitives.some(p=>p.type==='rect')).toBe(true);
 });
 it('leaves a companion beside the picture where the customer put it when the AI changes something else',()=>{
  const f=fixture(1);const first=f.candidate();
  const document={assets:first.assets,spec:first.spec,packName:'Mine',usage:'live' as const};
  const pet=document.spec.primitives.find(p=>p.assetPath==='/themes/u/ai-pet-1.cba')!;
  pet.x=30;pet.y=180;
  // What the helper is told (the nearest spot on the picture) and returns unchanged for a reused companion.
  Object.assign(f.concept.companions![0],{x:30,y:96,reuse:true});
  expect(applyAIThemeCandidate(document,f.candidate(),'auto').spec.primitives.find(p=>p.assetPath==='/themes/u/ai-pet-1.cba')).toMatchObject({x:30,y:180});
  Object.assign(f.concept.companions![0],{x:100,y:40});
  expect(applyAIThemeCandidate(document,f.candidate(),'auto').spec.primitives.find(p=>p.assetPath==='/themes/u/ai-pet-1.cba')).toMatchObject({x:100,y:40});
 });
 it('keeps the theme identity and an unchanged companion when the picture changes size, and treats a shorter legacy picture as the same layout',()=>{
  const f=fixture(1);const current=f.candidate();
  const document={assets:current.assets,spec:{...current.spec,themeId:'my-saved-theme',themeRev:7},packName:'Mine',usage:'live' as const};
  const g=fixture(1);Object.assign(g.concept,{artHeight:240,hideUsage:true});Object.assign(g.concept.companions![0],{reuse:true});
  const replaced=applyAIThemeCandidate(document,buildAIThemeCompanionCandidateFromRGBA(g.concept,new Uint8ClampedArray(240*240*4).fill(255),g.frames),'auto');
  expect(replaced.spec).toMatchObject({themeId:'my-saved-theme',themeRev:7});
  expect(replaced.assets['/themes/u/ai-pet-1.cba']).toEqual(document.assets['/themes/u/ai-pet-1.cba']);
  const legacy=structuredClone(document);
  legacy.assets[ART]={...legacy.assets[ART],data:legacy.assets[ART].data.replace('240 128','240 117')};
  expect(applyAIThemeCandidate(legacy,fixture(1).candidate(),'auto').spec.primitives.some(p=>p.binding==='session')).toBe(true);
  expect(applyAIThemeCandidate(legacy,fixture(1).candidate(),'auto').spec.themeId).toBe('my-saved-theme');
 });
});
