import {cloneDocument,type ThemeStudioDocument} from '@/components/theme-studio/theme-studio-editor-state';
import {LIVE_READINGS,setReading,usageSectionIndices} from '@/components/theme-studio/design-controls';
import {primitiveBounds,textPrimitiveNaturalWidth} from '@/components/theme-studio/editor-geometry';
import type {ThemeStudioPrimitive} from './theme-studio';
import {isCompanionSprite} from './ai-theme';
import {setAIAnimationSpeed} from './ai-theme-document';

export type AIThemeLayoutEdit={
  action:'add'|'update'|'remove'; index:number;
  kind?:'text'|'rect'|'progress'|'sprite'|null;
  x?:number|null; y?:number|null; width?:number|null; height?:number|null;
  fontSize?:number|null; color?:string|null; text?:string|null; reading?:string|null;
  fps?:number|null;
};
export type AIThemeLayoutPlan={mode:'layout'|'scene'|'unsupported';notes:string;edits:AIThemeLayoutEdit[]};

// Send geometry and native labels only, never sprite bytes or credentials.
export function layoutContext(document:ThemeStudioDocument, selected:number[]=[]){
  const groups=usageSectionIndices(document.spec.primitives);
  return document.spec.primitives.map((p,index)=>({type:p.type,x:p.x,y:p.y,width:p.width,height:p.height,fontSize:p.fontSize,color:p.color,bgColor:p.bgColor,text:p.text,binding:p.binding,slot:p.slot,fps:p.fps,selected:selected.includes(index),sceneName:document.packName,usageGroup:groups.findIndex(group=>group.includes(index))+1||undefined,role:isCompanionSprite(p.assetPath)?'companion':p.assetPath?'artwork':'ui',protected:isCompanionSprite(p.assetPath)?false:!!p.assetPath || !['text','rect','progress'].includes(p.type)}));
}

// All indices refer to the original document. Apply atomically, preserving all
// fields/assets not explicitly changed. Native edits never enter the image compiler.
export function applyAIThemeLayout(current:ThemeStudioDocument,plan:AIThemeLayoutPlan):ThemeStudioDocument{
  const fail=()=>{throw new Error('The AI layout edit is invalid. Your design is unchanged.');};
  if(plan.mode!=='layout'||!Array.isArray(plan.edits)||plan.edits.length>24) return fail();
  const next=cloneDocument(current),removed=new Set<number>(),seen=new Set<number>();
  const allowed=['action','index','kind','x','y','width','height','fontSize','color','text','reading','fps'];
  for(const edit of plan.edits){
    if(!edit||Object.keys(edit).some(k=>!allowed.includes(k))||!['add','update','remove'].includes(edit.action)||!Number.isInteger(edit.index)) return fail();
    let p:ThemeStudioPrimitive;
    if(edit.action==='add'){
      if(edit.index!==-1||!edit.kind||!['text','rect','progress'].includes(edit.kind)||edit.x==null||edit.y==null) return fail();
      p={type:edit.kind,x:edit.x,y:edit.y};
      const style=current.spec.primitives.find(existing=>existing.type===edit.kind);
      if(style){
        p.color=style.color;p.bgColor=style.bgColor;p.borderColor=style.borderColor;
        p.borderRadius=style.borderRadius;p.progressStyle=style.progressStyle;
        p.segments=style.segments;p.segmentGap=style.segmentGap;
      }
      next.spec.primitives.push(p);
    }else{
      const original=current.spec.primitives[edit.index];
      if(!original||seen.has(edit.index)) return fail();
      const companion=original.type==='sprite'&&isCompanionSprite(original.assetPath);
      if(!companion&&(original.assetPath||!['text','rect','progress'].includes(original.type))) return fail();
      seen.add(edit.index);p=next.spec.primitives[edit.index];
      if(edit.kind!=null&&edit.kind!==p.type) return fail();
      if(edit.action==='remove'){removed.add(edit.index);continue;}
      if(companion&&[edit.fontSize,edit.color,edit.text,edit.reading].some(v=>v!=null)) return fail();
    }
    for(const key of ['x','y','width','height','fontSize'] as const){
      const value=edit[key];
      if(value==null) continue;
      if(!Number.isInteger(value)||value<(['x','y'].includes(key)?0:1)||value>(key==='fontSize'?5:240)) return fail();
      p[key]=value;
    }
    if(edit.fps!=null){
      if(!isCompanionSprite(p.assetPath)||![0,1,2,4,8].includes(edit.fps)) return fail();
      setAIAnimationSpeed(next,p.assetPath!,edit.fps);
    }
    if(isCompanionSprite(p.assetPath)&&(p.width!==p.height||(p.width||0)<16||(p.width||0)>80||p.y+(p.height||0)>128)) return fail();
    if(edit.color!=null){if(!/^#[0-9a-f]{6}$/i.test(edit.color)) return fail();p.color=edit.color;}
    if(edit.text!=null){
      if(p.type!=='text'||typeof edit.text!=='string'||edit.text.length>160) return fail();
      // Classic display fonts interpret Unicode umlauts as unrelated CP437 glyphs.
      const umlauts:Record<string,string>={ä:'ae',ö:'oe',ü:'ue',Ä:'AE',Ö:'OE',Ü:'UE',ß:'ss'};
      p.text=edit.text.replace(/[äöüÄÖÜß]/g,c=>umlauts[c]).normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
      if(/[^\x20-\x7e\n]/.test(p.text)) throw new Error('The display font cannot show these characters. Please use a Latin-letter label. Your design is unchanged.');
      delete p.binding;
    }
    if(edit.reading!=null){
      if(!LIVE_READINGS.some(([id])=>id===edit.reading)||!['text','progress'].includes(p.type)) return fail();
      if(p.type==='progress'){
        if(!['session','weekly','usageSlot1Percent','usageSlot2Percent'].includes(edit.reading)) return fail();
        delete p.providerSlot;delete p.usageIndex;p.binding=edit.reading;p.slot=['weekly','usageSlot2Percent'].includes(edit.reading)?2:1;
      }else setReading(p,edit.reading);
    }
    if(p.type==='text'&&!p.text&&!p.binding) return fail();
    // Text widths are clipping boxes; grow them like the manual controls do so
    // a longer label, reading or font size is never cut off.
    if(p.type==='text'&&p.width&&(edit.text!=null||edit.reading!=null||edit.fontSize!=null)) p.width=Math.max(p.width,textPrimitiveNaturalWidth(p));
    if(p.type!=='text'&&(!p.width||!p.height)) return fail();
    const bounds=primitiveBounds({...p,x:0,y:0});
    if(p.x<0||p.y<0||p.x+bounds.width>240||p.y+bounds.height>240) return fail();
  }
  next.spec.primitives=next.spec.primitives.filter((_,i)=>!removed.has(i));
  return next;
}
