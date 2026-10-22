// Allocation-free artistic grading of linear light colors. Neutral values are
// identity; clamp the inputs in the shared workbench before rendering.
export function applyLightColor(color,controls){
 if(!controls)return color;
 const warmth=controls.warmth??0,saturation=controls.lightSaturation??1,tint=controls.tintAmount??0;
 color.r*=1+warmth*.34;color.g*=1+warmth*.04;color.b*=1-warmth*.38;
 const l=color.r*.2126+color.g*.7152+color.b*.0722;
 color.r=Math.max(0,l+(color.r-l)*saturation);color.g=Math.max(0,l+(color.g-l)*saturation);color.b=Math.max(0,l+(color.b-l)*saturation);
 if(tint>0&&/^#[0-9a-f]{6}$/i.test(controls.tintColor||'')){
  const hex=parseInt(controls.tintColor.slice(1),16);
  // Multiplicative tint keeps dark colors dark and avoids extra intensity.
  color.r*=1-tint+tint*((hex>>16&255)/255);color.g*=1-tint+tint*((hex>>8&255)/255);color.b*=1-tint+tint*((hex&255)/255);
 }
 return color;
}
