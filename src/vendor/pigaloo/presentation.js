import {XIRTUS_MAGIC_HOUR,XIRTUS_LOOK_SHARPER} from './xirtus-looks.js';
// Shared look and animation preferences for both worlds. Pose cadence never
// changes the motor's time step, speed, combat clocks or water simulation.
const BASE_LIGHTING={
 warm:{id:'warm',label:'Warm lantern',description:'Amber spotlight, soft warm bounce and luminous details. The everyday look.',ambient:.82,environment:.27,sun:.95,fill:.58,rim:.70,skyColor:'#ffe4c2',groundColor:'#76614f',sunColor:'#ffcf94',fillColor:'#ebaf88',rimColor:'#c5b5ee',exposure:1.10,emissiveGain:1.7,lampColor:'#ffc783',lampIntensity:.84,lampSpill:1.35,vignette:.52,fever:{ambient:1.9,key:1.03,rim:1.3,spot:.84,tintMix:.35,exposure:1.12}},
 noir:{id:'noir',label:'Velvet noir',description:'The original dark spotlight look: deep shadows and a tight amber pool.',exposure:1.05,emissiveGain:1,lampColor:'#ffc17b',lampIntensity:1,lampSpill:1,vignette:1,fever:{ambient:1,key:1,rim:1,spot:1,tintMix:0,exposure:1.1}},
 dusk:{id:'dusk',label:'Apricot dusk',description:'Golden hour, peach highlights and lilac shadows.',ambient:1.0,environment:.32,sun:1.35,fill:.65,rim:.8,skyColor:'#ffcfb0',groundColor:'#80637a',sunColor:'#ffb36f',fillColor:'#ffb2aa',rimColor:'#c8a1ff',exposure:1.08,emissiveGain:1.45,lampColor:'#ffce92',lampIntensity:.65,lampSpill:1.4,vignette:.45,fever:{ambient:2.15,key:1.3,rim:1.5,spot:.65,tintMix:.7,exposure:1.10}},
 moonlit:{id:'moonlit',label:'Blue moon',description:'Readable blue-violet night with a warm lantern and silver edges.',ambient:.72,environment:.22,sun:.7,fill:.48,rim:1.15,skyColor:'#c3ceff',groundColor:'#55516d',sunColor:'#a5b9ff',fillColor:'#8ba9eb',rimColor:'#dbdcff',exposure:1.08,emissiveGain:1.9,lampColor:'#ffd29c',lampIntensity:.9,lampSpill:1.15,vignette:.65,fever:{ambient:1.65,key:.8,rim:2,spot:.9,tintMix:.85,exposure:1.08}},
 neon:{id:'neon',label:'Neon fever',description:'Magenta and cyan light with glowing paint and colorful shadows.',ambient:.78,environment:.23,sun:.9,fill:1.0,rim:1.3,skyColor:'#efb2ee',groundColor:'#5b5b82',sunColor:'#ff94c9',fillColor:'#7cffe2',rimColor:'#88dfff',exposure:1.08,emissiveGain:2.4,lampColor:'#ffdaa6',lampIntensity:.72,lampSpill:1.3,vignette:.6,fever:{ambient:1.8,key:.95,rim:2.2,spot:.72,tintMix:.8,exposure:1.1}},
 storybook:{id:'storybook',label:'Soft storybook',description:'Broad creamy light, gentle shadows and clear fabric detail.',ambient:1.35,environment:.42,sun:1.2,fill:.8,rim:.65,skyColor:'#fff0d8',groundColor:'#8a7a68',sunColor:'#ffe1b0',fillColor:'#f3daca',rimColor:'#cbd4f4',exposure:1.02,emissiveGain:1.3,lampColor:'#ffdfb1',lampIntensity:.5,lampSpill:1.5,vignette:.25,fever:{ambient:2.6,key:1.2,rim:1.25,spot:.5,tintMix:.55,exposure:1.03}},
};
export const LIGHTING_PRESETS=Object.freeze({
 xirtusMagicHour:{...BASE_LIGHTING.warm,id:'xirtusMagicHour',label:'Xirtus · Magic Hour',featured:true,description:'Xirtus’s primary template: high rear lantern, deep warm shadows, golden rim and saturated sunset. Original authored settings.',controls:{...XIRTUS_MAGIC_HOUR.overrides}},
 xirtusSharper:{...BASE_LIGHTING.warm,id:'xirtusSharper',label:'Xirtus · Look Sharper',featured:true,description:'Xirtus’s sharper lighting and placement, with stronger fine film grain.',controls:{...XIRTUS_LOOK_SHARPER.overrides,grain:.34,grainContrast:2.5}},
 magicHourVelvet:{...BASE_LIGHTING.warm,id:'magicHourVelvet',label:'Magic Hour · velvet flood',featured:true,template:'xirtusMagicHour',description:'Built from Xirtus Magic Hour: the same high rear rig with a broader, softer lantern pool.',controls:{...XIRTUS_MAGIC_HOUR.overrides,angle:48,softness:.85,focus:.18}},
 magicHourFilm:{...BASE_LIGHTING.warm,id:'magicHourFilm',label:'Magic Hour · film stock',featured:true,template:'xirtusMagicHour',description:'Built from Xirtus Magic Hour: warmer film texture with finer, more pronounced grain.',controls:{...XIRTUS_MAGIC_HOUR.overrides,grain:.28,grainScale:1.2,grainContrast:2.2}},
 ...BASE_LIGHTING,
 lanternSoft:{...BASE_LIGHTING.warm,id:'lanternSoft',label:'Warm lantern · soft flood',description:'A wider amber pool with soft edges, warm bounce and gentle focus.',controls:{angle:50,softness:.85,focus:.2,intensity:1.2,warmth:.28,lightSaturation:1.15,height:3.5,fill:1.15}},
 amberVelvet:{...BASE_LIGHTING.warm,id:'amberVelvet',label:'Warm lantern · amber velvet',description:'Rich amber and plum shadows, broad soft light and a gently focused center.',controls:{lampColor:'#ffd09a',angle:46,softness:.78,focus:.38,intensity:1.35,warmth:.45,lightSaturation:1.4,fillColor:'#d39588',rimColor:'#dfabbc',grain:.065,filmStyle:'warm',filmSaturation:1.08}},
 honeyDusk:{...BASE_LIGHTING.warm,id:'honeyDusk',label:'Warm lantern · honey dusk',description:'Honey-colored light beneath a peach sunset, broad enough to read the quilt.',controls:{angle:56,softness:.9,focus:.12,intensity:1.2,warmth:.35,lightSaturation:1.3,skyMode:'sunset',skyBrightness:1.1,skySaturation:1.15,ambient:1.12,fill:1.2,filmStyle:'warm'}},
 candleClay:{...BASE_LIGHTING.warm,id:'candleClay',label:'Warm lantern · candle clay',description:'Low tungsten stage light, soft sculpted shadows and textured warm film.',controls:{lampColor:'#ffb768',height:1.5,back:3.5,side:2.5,angle:45,softness:.8,focus:.28,intensity:1.3,warmth:.32,lightSaturation:1.2,grain:.105,grainScale:1.5,filmStyle:'faded',vignette:.62}},
 dollhouse:{...BASE_LIGHTING.warm,id:'dollhouse',label:'Dollhouse horror',description:'Little Nightmares–inspired amber practical light, teal shadows and a low theatrical pool.',reference:'https://en.bandainamcoent.eu/little-nightmares/little-nightmares',ambient:.55,fill:.32,rim:.8,skyColor:'#b4c7c2',groundColor:'#363f3a',fillColor:'#5eaaa4',sunColor:'#e8b57d',fever:{ambient:1.35,key:.65,rim:1.3,spot:1.1,tintMix:.8,exposure:1.05},controls:{height:1.8,side:2.6,back:2.4,angle:29,focus:.6,softness:.28,vignette:.75}},
 spirit:{...BASE_LIGHTING.moonlit,id:'spirit',label:'Spirit forest',description:'Ori-inspired luminous cyan edges, violet shade and soft pools of light.',reference:'https://www.orithegame.com/screenshot_category/ori-and-the-blind-forest/',ambient:.9,fill:.9,rim:1.5,skyColor:'#b6d3ff',groundColor:'#514b80',fillColor:'#74daca',rimColor:'#8bffe8',emissiveGain:2.8,fever:{ambient:2,key:.75,rim:2.5,spot:.65,tintMix:.9,exposure:1.1},controls:{lampColor:'#aeece0',height:4.5,angle:47,softness:.85,focus:.1,vignette:.4}},
 industrial:{...BASE_LIGHTING.moonlit,id:'industrial',label:'Industrial hush',description:'INSIDE-inspired cold overhead pools, restrained fill and hard silhouettes.',reference:'https://www.playdead.com/games/inside/',ambient:.43,fill:.25,rim:.9,skyColor:'#a8bac8',groundColor:'#404753',sunColor:'#bbced7',fillColor:'#8b9fa5',rimColor:'#e1d8b9',emissiveGain:1.2,fever:{ambient:1.15,key:.55,rim:1.6,spot:.9,tintMix:1,exposure:1.0},controls:{lampColor:'#e3e5d5',height:7,back:.5,side:0,aim:1.5,angle:24,softness:.18,focus:.65,vignette:.7}},
 theatre:{...BASE_LIGHTING.dusk,id:'theatre',label:'Clay theatre',description:'Miniature tungsten stage lighting with a soft Fresnel pool and plum bounce.',ambient:.72,fill:.48,rim:.85,fever:{ambient:1.65,key:.8,rim:1.5,spot:.95,tintMix:.75,exposure:1.08},controls:{height:4,back:4,side:3,angle:41,softness:.65,focus:.25,grain:.09}},
 arcade:{...BASE_LIGHTING.neon,id:'arcade',label:'Arcade afterglow',description:'Violet overhead light, electric cyan bounce and concentrated pink highlights.',sunColor:'#ba86ff',fillColor:'#64e5ff',rimColor:'#ff91bd',fever:{ambient:1.7,key:.75,rim:2.8,spot:.8,tintMix:1,exposure:1.1},controls:{lampColor:'#ffc1e2',height:3.5,side:-2.5,angle:38,focus:.5,softness:.6}},
});
export const MOTION_PRESETS=Object.freeze({
 clay:{id:'clay',label:'Stop-motion · 12 fps',description:'Hand-posed clay frames with continuous controls.',fps:12},
 cinematic:{id:'cinematic',label:'Cinematic · 24 fps',description:'Finer film cadence with the same movement weight.',fps:24},
 game:{id:'game',label:'Smooth game',description:'Animation updates every rendered frame.',fps:0},
 custom:{id:'custom',label:'Custom cadence',description:'Choose your own held-pose frame rate. Travel stays continuous.',fps:18},
});
// Bounded editing keeps imported looks and accidental input inside usable ranges.
export const CONTROL_SCHEMA={
 height:{label:'Height above head',min:-.5,max:12,step:.1,unit:'m',value:2.6,group:'Placement'},
 back:{label:'Behind character',min:-8,max:12,step:.1,unit:'m',value:3.2,group:'Placement'},
 side:{label:'Side offset',min:-8,max:8,step:.1,unit:'m',value:1.4,group:'Placement'},
 aim:{label:'Aim ahead',min:-6,max:20,step:.1,unit:'m',value:6,group:'Placement'},
 targetHeight:{label:'Aim height from head',min:-4,max:6,step:.1,unit:'m',value:-2.12,group:'Placement'},
 angle:{label:'Cone half-angle',min:8,max:70,step:1,unit:'°',value:34.4,group:'Lens & beam'},
 focus:{label:'Fresnel focus · flood to spot',min:0,max:1,step:.01,value:.35,group:'Lens & beam'},
 softness:{label:'Beam edge softness',min:0,max:1,step:.01,value:.4,group:'Lens & beam'},
 intensity:{label:'Lamp power',min:0,max:4,step:.05,unit:'×',value:1,group:'Lens & beam'},
 range:{label:'Throw distance',min:8,max:90,step:1,unit:'m',value:31,group:'Lens & beam'},
 decay:{label:'Light falloff',min:0,max:2,step:.05,value:1.45,group:'Lens & beam'},
 lampColor:{label:'Lamp color',type:'color',value:'#ffc783',group:'Lens & beam'},
 ambient:{label:'Ambient bounce',min:0,max:3,step:.05,unit:'×',value:1,group:'Scene lighting'},
 key:{label:'Scenic key',min:0,max:3,step:.05,unit:'×',value:1,group:'Scene lighting'},
 fill:{label:'Fill light',min:0,max:3,step:.05,unit:'×',value:1,group:'Scene lighting'},
 rim:{label:'Rim light',min:0,max:3,step:.05,unit:'×',value:1,group:'Scene lighting'},
 glow:{label:'Material glow',min:0,max:4,step:.05,unit:'×',value:1,group:'Scene lighting'},
 warmth:{label:'Light warmth · cool to amber',min:-1,max:1,step:.01,value:0,group:'Color & warmth'},
 lightSaturation:{label:'Light color saturation',min:0,max:2,step:.05,value:1,group:'Color & warmth'},
 tintColor:{label:'Light tint',type:'color',value:'#ffbf80',group:'Color & warmth'},
 tintAmount:{label:'Tint strength',min:0,max:1,step:.01,value:0,group:'Color & warmth'},
 skyColor:{label:'Ambient color',type:'color',value:'#ffe4c2',group:'Color & warmth'},
 sunColor:{label:'Key color',type:'color',value:'#ffcf94',group:'Color & warmth'},
 fillColor:{label:'Fill color',type:'color',value:'#ebaf88',group:'Color & warmth'},
 rimColor:{label:'Rim color',type:'color',value:'#c5b5ee',group:'Scene lighting'},
 shadows:{label:'Spotlight casts shadows',type:'checkbox',value:true,group:'Shadows & film'},
 shadowSoftness:{label:'Shadow filter radius',min:0,max:4,step:.1,value:1,group:'Shadows & film'},
 shadowBias:{label:'Shadow depth bias',min:-.002,max:.002,step:.00005,value:-.00015,group:'Shadows & film'},
 shadowNormalBias:{label:'Surface shadow offset',min:0,max:.15,step:.005,unit:'m',value:.025,group:'Shadows & film'},
 exposure:{label:'Exposure',min:.35,max:2,step:.05,unit:'×',value:1,group:'Shadows & film'},
 vignette:{label:'Vignette',min:0,max:1,step:.01,value:.52,group:'Shadows & film'},
 filmStyle:{label:'Film filter',type:'select',options:{neutral:'Neutral print',warm:'Warm print',faded:'Faded stock',silver:'Silver screen',vivid:'Vivid fantasy'},value:'neutral',group:'Film finish'},
 filmSaturation:{label:'Image saturation',min:0,max:2,step:.05,value:1,group:'Film finish'},
 filmContrast:{label:'Image contrast',min:.5,max:1.6,step:.05,value:1,group:'Film finish'},
 filmWarmth:{label:'Print warmth',min:0,max:1,step:.01,value:0,group:'Film finish'},
 grainContrast:{label:'Grain contrast',min:1,max:4,step:.1,value:1,group:'Film finish'},
 grainScale:{label:'Grain size',min:.5,max:3,step:.1,value:1,group:'Film finish'},
 grainRate:{label:'Grain cadence',min:0,max:30,step:1,unit:'fps',value:12,group:'Film finish'},
 grain:{label:'Film grain',min:0,max:.5,step:.005,value:.075,group:'Film finish'},
 skyMode:{label:'Sky palette',type:'select',options:{cycle:'World / cycling sky',dawn:'Apricot dawn',sunset:'Tangerine sunset',night:'Blue aurora',custom:'Custom colors'},value:'cycle',group:'Skybox'},
 skyBrightness:{label:'Sky brightness',min:0,max:2,step:.05,value:1,group:'Skybox'},
 skySaturation:{label:'Sky saturation',min:0,max:2,step:.05,value:1,group:'Skybox'},
 skyZenith:{label:'Upper sky',type:'color',value:'#4876cb',group:'Skybox'},
 skyHorizon:{label:'Horizon',type:'color',value:'#ffb074',group:'Skybox'},
 skyCloudColor:{label:'Cloud color',type:'color',value:'#ffd8bb',group:'Skybox'},
 skyClouds:{label:'Cloud amount',min:0,max:2,step:.05,value:1,group:'Skybox'},
 skySpeed:{label:'Sky motion speed',min:0,max:2,step:.05,value:1,group:'Skybox'},
};
const state={lighting:'warm',motion:'clay'},listeners=new Set();
let overrides={},customLooks=[],customFps=18,resolved=null;
const valid=(catalog,id)=>typeof id==='string'&&Object.hasOwn(catalog,id);
function sanitize(input){const result={};if(!input||typeof input!=='object')return result;for(const [key,spec]of Object.entries(CONTROL_SCHEMA)){const v=input[key];if(spec.type==='select'){if(Object.hasOwn(spec.options,v))result[key]=v;}else if(spec.type==='color'){if(typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v))result[key]=v;}else if(spec.type==='checkbox'){if(typeof v==='boolean')result[key]=v;}else if(typeof v==='number'&&Number.isFinite(v))result[key]=Math.max(spec.min,Math.min(spec.max,v));}return result;}
function cleanLook(value){if(!value||!valid(LIGHTING_PRESETS,value.lighting))throw new Error('Choose a supported lighting preset.');return {lighting:value.lighting,motion:valid(MOTION_PRESETS,value.motion)?value.motion:'clay',overrides:sanitize(value.overrides),customFps:Math.max(6,Math.min(60,Number(value.customFps)||18))};}
try{if(typeof document!=='undefined'&&typeof localStorage!=='undefined'){
 const saved=JSON.parse(localStorage.getItem('pigaloo-presentation-v1')||'{}');if(valid(LIGHTING_PRESETS,saved.lighting))state.lighting=saved.lighting;if(valid(MOTION_PRESETS,saved.motion))state.motion=saved.motion;
 overrides=sanitize(saved.overrides);customFps=Math.max(6,Math.min(60,Number(saved.customFps)||18));
 if(Array.isArray(saved.customLooks))customLooks=saved.customLooks.slice(0,24).flatMap(x=>{try{return [{name:String(x.name||'My look').slice(0,48),...cleanLook(x)}];}catch{return [];}});
 }
 if(typeof location!=='undefined'){const p=new URLSearchParams(location.search);if(valid(LIGHTING_PRESETS,p.get('lighting'))){state.lighting=p.get('lighting');overrides={};}if(valid(MOTION_PRESETS,p.get('motion')))state.motion=p.get('motion');}
}catch{/* Optional browser storage. */}
export const getPresentation=()=>({...state});
export const getWorkbenchSnapshot=()=>({version:1,...state,overrides:{...overrides},customFps});
export function getLightingPreset(id=state.lighting){
 const base=valid(LIGHTING_PRESETS,id)?LIGHTING_PRESETS[id]:LIGHTING_PRESETS.warm;
 if(base.id===state.lighting&&resolved)return resolved;
 const controls=Object.fromEntries(Object.entries(CONTROL_SCHEMA).map(([key,spec])=>[key,spec.value]));
 for(const key of ['lampColor','skyColor','sunColor','fillColor','rimColor','vignette'])if(base[key]!==undefined)controls[key]=base[key];
 controls.grain=state.motion==='game'?.025:state.motion==='cinematic'?.045:.075;controls.grainRate=state.motion==='game'?0:state.motion==='cinematic'?24:12;
 Object.assign(controls,base.controls,base.id===state.lighting?overrides:{});
 const result={...base,controls:Object.freeze(controls)};
 if(base.id===state.lighting)resolved=result;return result;
}
export const getMotionPreset=(id=state.motion)=>id==='custom'?{...MOTION_PRESETS.custom,fps:customFps}:valid(MOTION_PRESETS,id)?MOTION_PRESETS[id]:MOTION_PRESETS.clay;
export const motionTime=time=>{const fps=getMotionPreset().fps;return fps?Math.floor((time+1e-9)*fps)/fps:time;};
export const motionFrame=time=>{const fps=getMotionPreset().fps;return fps?Math.floor((time+1e-9)*fps):time;};
function changed(){resolved=null;try{if(typeof document!=='undefined'&&typeof localStorage!=='undefined')localStorage.setItem('pigaloo-presentation-v1',JSON.stringify({...getWorkbenchSnapshot(),customLooks}));}catch{}for(const listener of listeners)listener(getPresentation());}
export function setPresentation(next={}){
 const before=JSON.stringify(getWorkbenchSnapshot());
 if(valid(LIGHTING_PRESETS,next.lighting)){if(next.lighting!==state.lighting)overrides={};state.lighting=next.lighting;}
 if(valid(MOTION_PRESETS,next.motion))state.motion=next.motion;
 if(before!==JSON.stringify(getWorkbenchSnapshot()))changed();return getPresentation();
}
export function setLightingControls(next){overrides={...overrides,...sanitize(next)};changed();return getLightingPreset().controls;}
export function resetLightingControls(){overrides={};changed();}
export function setCustomFps(value){if(Number.isFinite(value)){customFps=Math.max(6,Math.min(60,Math.round(value)));state.motion='custom';changed();}}
export function restoreWorkbench(value){const look=cleanLook(value);Object.assign(state,{lighting:look.lighting,motion:look.motion});overrides=look.overrides;customFps=look.customFps;changed();}
export const listSavedLooks=()=>customLooks.map(look=>({...look,overrides:{...look.overrides}}));
export function saveLook(name){name=String(name||'My look').trim().slice(0,48)||'My look';const look={...getWorkbenchSnapshot(),name};const index=customLooks.findIndex(x=>x.name===name);if(index>=0)customLooks[index]=look;else{if(customLooks.length>=24)throw new Error('Remove a saved look before adding another.');customLooks.push(look);}changed();return name;}
export function deleteLook(name){customLooks=customLooks.filter(x=>x.name!==name);changed();}
export function subscribePresentation(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
