import {DataTexture,RGBAFormat,UnsignedByteType,LinearFilter,ClampToEdgeWrapping} from 'three';

/** Fresnel-style radial beam shaping, not a physical lens simulation.
 * One small cookie per lamp; only edit pixels when focus actually changes. */
export function createSpotlightLens(){
 const size=64,data=new Uint8Array(size*size*4),texture=new DataTexture(data,size,size,RGBAFormat,UnsignedByteType);
 texture.name='Fresnel spot–flood beam';texture.minFilter=texture.magFilter=LinearFilter;texture.wrapS=texture.wrapT=ClampToEdgeWrapping;texture.generateMipmaps=false;
 let previous=-1;
 function update(focus=0){focus=Number.isFinite(focus)?Math.min(1,Math.max(0,focus)):0;if(focus===previous)return;previous=focus;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const r=Math.hypot((x+.5)/size*2-1,(y+.5)/size*2-1);
   // Flood keeps the entire cone lit; spot concentrates it around the axis.
   // Edge feathering belongs to the light's separate penumbra control.
   const power=(1-focus)+focus*Math.exp(-r*r*(2+focus*10));
   const i=(y*size+x)*4,v=Math.round(255*power);data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
  }texture.needsUpdate=true;
 }
 update(0);return {texture,update,dispose(){texture.dispose();}};
}
