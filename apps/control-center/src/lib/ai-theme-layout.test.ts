import {describe,it,expect} from 'vitest';
import {applyAIThemeLayout, layoutContext, type AIThemeLayoutPlan} from './ai-theme-layout';
import {createBlankThemeSpec} from './theme-studio';
import {createThemeStudioEditorState,themeStudioEditorReducer,type ThemeStudioDocument} from '@/components/theme-studio/theme-studio-editor-state';
import {textPrimitiveNaturalWidth} from '@/components/theme-studio/editor-geometry';

const before:ThemeStudioDocument={packName:'Office cat',usage:'live',assets:{'/themes/u/cat.cba':{contentType:'text/plain',encoding:'text',data:'unchanged-sprite'}},spec:{...createBlankThemeSpec(),primitives:[{type:'sprite',assetPath:'/themes/u/cat.cba',x:20,y:30,width:32,height:32},{type:'text',x:12,y:140,text:'SESSION',color:'#FFFFFF',fontSize:2}]}};
const add={action:'add',index:-1,kind:'text',x:12,y:224,fontSize:1,color:'#FFFFFF',reading:'usageSlot1Reset'} as const;
const plan=(edits:AIThemeLayoutPlan['edits']):AIThemeLayoutPlan=>({mode:'layout',notes:'Added reset countdown',edits});
describe('AI native layout edits',()=>{
 it('clears provider/usage owners when the AI replaces a reading with literal text',()=>{
  const doc=structuredClone(before);
  doc.spec.primitives.push({type:'text',x:12,y:200,text:'{providerSlot1Name}',binding:'providerSlot1Name',providerSlot:1,slot:1,usageIndex:0,color:'#FFFFFF',fontSize:1});
  const next=applyAIThemeLayout(doc,plan([{action:'update',index:2,kind:'text',text:'OFFICE'}]));
  const label=next.spec.primitives[2];
  expect(label.text).toBe('OFFICE');
  for(const key of ['binding','slot','providerSlot','usageIndex']) expect(label).not.toHaveProperty(key);
 });
 it('widens a clipped text box when the AI assigns longer content',()=>{
  const doc=structuredClone(before);
  doc.spec.primitives.push({type:'text',x:12,y:200,width:30,text:'12:00',color:'#FFFFFF',fontSize:1});
  const next=applyAIThemeLayout(doc,plan([{action:'update',index:2,kind:'text',reading:'usageSlot1Reset'}]));
  const label=next.spec.primitives[2];
  expect(label.width).toBeGreaterThan(30);
  expect(label.width).toBe(textPrimitiveNaturalWidth(label));
 });
 it('clears old provider/usage owners when the AI changes a bar reading',()=>{
  const doc=structuredClone(before);
  doc.spec.primitives.push({type:'progress',x:12,y:204,width:216,height:13,color:'#0055AA',binding:'providerSlot1Percent',providerSlot:1,usageIndex:0});
  const next=applyAIThemeLayout(doc,plan([{action:'update',index:2,kind:'progress',reading:'weekly'}]));
  const bar=next.spec.primitives[2];
  expect(bar).toMatchObject({binding:'weekly',slot:2});
  expect(bar).not.toHaveProperty('providerSlot');
  expect(bar).not.toHaveProperty('usageIndex');
 });
 it('adds a bar using the existing design styling instead of black/green renderer defaults',()=>{
  const doc=structuredClone(before);
  doc.spec.primitives.push({type:'progress',x:12,y:204,width:216,height:13,color:'#0055AA',bgColor:'#EAF6FF',borderColor:'#FFB56B',borderRadius:0,progressStyle:'solid',binding:'weekly'});
  const next=applyAIThemeLayout(doc,plan([{action:'add',index:-1,kind:'progress',x:12,y:160,width:216,height:13,reading:'session',color:'#0055AA'}]));
  expect(next.spec.primitives.at(-1)).toMatchObject({bgColor:'#EAF6FF',borderColor:'#FFB56B',borderRadius:0,progressStyle:'solid',binding:'session'});
  expect(next.spec.primitives.slice(0,-1)).toEqual(doc.spec.primitives);
 });
 it('provides usage-section ownership for removing the whole section including used/remaining',()=>{
  const doc=structuredClone(before);doc.spec.primitives.push({type:'progress',x:12,y:180,width:216,height:12,binding:'weekly'},{type:'text',x:12,y:196,text:'{usageMode}'});
  const context=layoutContext(doc);
  expect(context[2]).toMatchObject({usageGroup:2});expect(context[3]).toMatchObject({usageGroup:2});
 });
 it('makes generated German labels readable by the built-in display font',()=>{
  const next=applyAIThemeLayout(before,plan([{action:'update',index:1,text:'WÖCHENTLICH'}]));
  expect(next.spec.primitives[1].text).toBe('WOECHENTLICH');
 });
 it('pauses and resumes an existing companion without changing frame pixels',()=>{
  const doc=structuredClone(before);const path='/themes/u/ai-pet-1.cba';doc.spec.primitives[0].assetPath=path;
  doc.assets[path]={contentType:'text/plain',encoding:'text',data:'CBA1\n32 32 8 4\n1\nFFFFFF\nunchanged-pixels'};
  const paused=applyAIThemeLayout(doc,plan([{action:'update',index:0,fps:0}]));
  expect(paused.assets[path].data).toBe(doc.assets[path].data.replace('32 32 8 4','32 32 8 0'));
  expect(paused.spec.primitives[0].fps).toBe(0);
  expect(applyAIThemeLayout(paused,plan([{action:'update',index:0,fps:4}])).assets).toEqual(doc.assets);
 });
 it('resizes and moves existing companions without recompiling their drawings',()=>{
  const doc=structuredClone(before);
  doc.spec.primitives[0].assetPath='/themes/u/ai-pet-1.cba';
  doc.assets['/themes/u/ai-pet-1.cba']=doc.assets['/themes/u/cat.cba'];
  const next=applyAIThemeLayout(doc,plan([{action:'update',index:0,width:48,height:48,x:10,y:14}]));
  expect(next.assets).toEqual(doc.assets);
  expect(next.spec.primitives[0]).toMatchObject({width:48,height:48,x:10,y:14});
  expect(next.spec.primitives[1]).toEqual(doc.spec.primitives[1]);
  expect(layoutContext(doc)[0]).toMatchObject({protected:false,role:'companion',sceneName:'Office cat'});
  expect(applyAIThemeLayout(doc,plan([{action:'remove',index:0}])).spec.primitives).toEqual([doc.spec.primitives[1]]);
 });
 it('rejects recoloring sprite pixels and off-scene or distorted companion geometry',()=>{
  const doc=structuredClone(before);doc.spec.primitives[0].assetPath='/themes/u/ai-pet-1.cba';
  for(const edit of [{color:'#FF0000'},{width:60,height:40},{y:110},{width:81,height:81},{text:'cat'}])
   expect(()=>applyAIThemeLayout(doc,plan([{action:'update',index:0,...edit}]))).toThrow();
 });
 it('enlarges the displayed companion beyond 64px without enlarging or rewriting its source frames',()=>{
  const doc=structuredClone(before);const path='/themes/u/ai-pet-1.cba';
  doc.spec.primitives[0]={type:'sprite',assetPath:path,x:109,y:47,width:64,height:64};
  doc.assets[path]=doc.assets['/themes/u/cat.cba'];
  const next=applyAIThemeLayout(doc,plan([{action:'update',index:0,width:80,height:80,x:101,y:31}]));
  expect(next.spec.primitives[0]).toMatchObject({width:80,height:80,x:101,y:31});
  expect(next.assets).toEqual(doc.assets);
  expect(next.spec.primitives[1]).toEqual(doc.spec.primitives[1]);
  expect(applyAIThemeLayout(next,plan([{action:'update',index:0,width:80,height:80,x:77,y:0}])).spec.primitives[0].width).toBe(80);
 });
 it('adds a live reset without decoding/replacing any artwork',()=>{
  const next=applyAIThemeLayout(before,plan([add]));
  expect(next.assets).toEqual(before.assets);expect(next.spec.primitives.slice(0,2)).toEqual(before.spec.primitives);
  expect(next.spec.primitives[2]).toMatchObject({type:'text',text:'Reset in {usageSlot1Reset}',slot:1,x:12,y:224});
  const initial=createThemeStudioEditorState(before),changed=themeStudioEditorReducer(initial,{type:'update',document:next});
  expect(themeStudioEditorReducer(changed,{type:'undo'}).present).toEqual(initial.present);
 });
 it('moves, recolors, relabels and removes native elements by original index',()=>{
  const next=applyAIThemeLayout(before,plan([{action:'update',index:1,x:30,color:'#FF0000',text:'WORK'}]));
  expect(next.spec.primitives[1]).toMatchObject({x:30,y:140,text:'WORK',color:'#FF0000'});
  expect(applyAIThemeLayout(next,plan([{action:'remove',index:1}])).spec.primitives).toEqual([before.spec.primitives[0]]);
 });
 it('supports the second-window reset and clock without invented values',()=>{
  const next=applyAIThemeLayout(before,plan([{...add,reading:'usageSlot2Reset'},{...add,reading:'time',y:200}]));
  expect(next.spec.primitives[2].text).toBe('Reset in {usageSlot2Reset}');expect(next.spec.primitives[3].text).toBe('{time}');
 });
 it('rejects protected artwork, bad indices, off-screen edits and unknown fields atomically',()=>{
  for(const edit of [{action:'remove',index:0},{action:'update',index:99,x:1},{...add,y:239},{...add,reading:'invented'}, {...add,assetPath:'/evil'}, {action:'update',index:1,kind:'rect'}]){
   expect(()=>applyAIThemeLayout(before,plan([edit as never]))).toThrow();
  }
  expect(before.spec.primitives).toHaveLength(2);
 });
 it('treats null fields as unchanged and rejects contradictory or image plans',()=>{
  expect(applyAIThemeLayout(before,plan([{action:'update',index:1,x:null,text:null}])).spec.primitives).toEqual(before.spec.primitives);
  expect(()=>applyAIThemeLayout(before,plan([{action:'remove',index:1},{action:'update',index:1,x:2}]))).toThrow();
  expect(()=>applyAIThemeLayout(before,{mode:'scene',notes:'',edits:[]})).toThrow();
 });
});
