import * as T from 'three';
import {applyLightColor} from '../light-color.js';
/** Track authored glow once per material; preset changes never compound gain.
 * Refresh only when a world or asynchronously loaded actor joins the scene. */
export function createEmissiveGainCache(){
 const authored=new WeakMap();let active=[],gain=1;
 return {
  refresh(root){
   const found=new Set();
   root.traverse(object=>{if(!object.isMesh)return;for(const material of (Array.isArray(object.material)?object.material:[object.material])){
    if(!material?.emissive||!Number.isFinite(material.emissiveIntensity)||found.has(material))continue;
    if(!authored.has(material))authored.set(material,material.emissiveIntensity);
    found.add(material);
   }});
   active=[...found];for(const material of active)material.emissiveIntensity=authored.get(material)*gain;
  },
  setGain(value=1){gain=Number.isFinite(value)?Math.max(0,value):1;for(const material of active)material.emissiveIntensity=authored.get(material)*gain;},
  get count(){return active.length;},
 };
}

// Capture immediately after a district or dynamic island/river lighting reset.
// This preserves authored noir values without accumulating slider multipliers.
const baselines=new WeakMap();
const LIGHT_COLOR_KEYS=['ambient','sun','fill','rim','ground'];
function lightColor(rig,key){return key==='ground'?rig.ambient.groundColor:rig[key].color;}
import {XIRTUS_MAGIC_HOUR} from '../xirtus-looks.js';
const MAGIC={rim:XIRTUS_MAGIC_HOUR.overrides.rim,key:XIRTUS_MAGIC_HOUR.overrides.key},MAGIC_RIM=new T.Color(XIRTUS_MAGIC_HOUR.overrides.rimColor);
const UNDERWATER_SKY=new T.Color('#3fa39f'),UNDERWATER_DEEP=new T.Color('#0d2f3a'),UNDERWATER_SUN=new T.Color('#ffd79a');
export function captureWorldLightingBaseline(rig){
 const {ambient,sun,fill,rim,scene}=rig;
 let values=baselines.get(rig);
 if(!values){values={colors:{},lastColors:{}};baselines.set(rig,values);}
 for(const key of LIGHT_COLOR_KEYS){
  const color=lightColor(rig,key);
  if(!values.colors[key]){values.colors[key]=color.clone();values.lastColors[key]=color.clone();}
  else if(!color.equals(values.lastColors[key]))values.colors[key].copy(color);
 }
 values.ambient=ambient.intensity;values.sun=sun.intensity;values.fill=fill.intensity;values.rim=rim.intensity;values.environment=scene.environmentIntensity;
}

/** Absolute profile values go after district/island lighting, never compound. */
export function applyWorldLightingPreset(rig,profile,{immersed=false}={}){
 const {ambient,sun,fill,rim,scene,renderer,divingLight}=rig;
 const controls=profile.controls||{};
 divingLight?.setStyle(profile);
 renderer.toneMappingExposure=(profile.exposure??1.05)*(controls.exposure??1);
 if(!baselines.has(rig))captureWorldLightingBaseline(rig);
 const saved=baselines.get(rig);
 if(profile.id==='noir'){
  ambient.intensity=saved.ambient*(controls.ambient??1);
  sun.intensity=saved.sun*(controls.key??1);
  fill.intensity=saved.fill*(controls.fill??1);
  rim.intensity=saved.rim*(controls.rim??1);
  scene.environmentIntensity=saved.environment*(controls.ambient??1);
  for(const key of LIGHT_COLOR_KEYS)lightColor(rig,key).copy(saved.colors[key]);
  if(controls.skyColor)ambient.color.set(controls.skyColor);
  if(controls.sunColor)sun.color.set(controls.sunColor);
  if(controls.fillColor)fill.color.set(controls.fillColor);
  if(controls.rimColor)rim.color.set(controls.rimColor);
 }else{
  const water=immersed?.68:1;
  ambient.intensity=profile.ambient*water*(controls.ambient??1);ambient.color.set(controls.skyColor||profile.skyColor);ambient.groundColor.set(profile.groundColor);
  sun.intensity=profile.sun*(immersed?.56:1)*(controls.key??1);sun.color.set(controls.sunColor||profile.sunColor);
  fill.intensity=profile.fill*water*(controls.fill??1);fill.color.set(controls.fillColor||profile.fillColor);
  rim.intensity=profile.rim*(immersed?.75:1)*(controls.rim??1);rim.color.set(controls.rimColor||profile.rimColor);
  if(immersed){
   // Magic hour through water: the sunset sky refracts teal-gold, the key keeps
   // its warmth through the surface, the golden rim survives as the edge light
   // and the fill turns to the water's own sea-green bounce.
   ambient.color.lerp(UNDERWATER_SKY,.55);ambient.groundColor.lerp(UNDERWATER_DEEP,.6);
   sun.color.lerp(UNDERWATER_SUN,.35);fill.color.lerp(UNDERWATER_SKY,.6);fill.intensity*=1.25;
   rim.intensity=profile.rim*.95*(controls.rim??1);
   // Template: Xirtus Magic Hour's golden rim and warm high key, whatever the
   // surface preset, so the drowned scenes keep its sunset edge light.
   rim.color.lerp(MAGIC_RIM,.7);rim.intensity=Math.max(rim.intensity,MAGIC.rim*.55);
   sun.intensity=Math.max(sun.intensity,MAGIC.key*.5);ambient.intensity=Math.max(ambient.intensity,.34);
  }
  scene.environmentIntensity=profile.environment*(immersed?.65:1)*(controls.ambient??1);
 }
 for(const key of LIGHT_COLOR_KEYS){const color=lightColor(rig,key);applyLightColor(color,controls);saved.lastColors[key].copy(color);}
}
