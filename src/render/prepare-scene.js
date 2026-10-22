/** Prepare all authored sector materials before input is enabled. Frustum culling
 * must be disabled during compilation: otherwise only the starting view warms. */
export async function prepareScene(renderer, scene, camera, scenePass = null, renderFrame = null) {
  const culling = [];
  scene.traverse(object => {
    if (!object.isMesh && !object.isPoints) return;
    culling.push([object, object.frustumCulled]);
    object.frustumCulled = false;
  });
  try {
    scene.updateMatrixWorld(true);
    if (scenePass) await scenePass.compileAsync(renderer);
    // Also prepare direct rendering so disabling bloom does not cause a stall.
    await renderer.compileAsync(scene, camera);
    // Shadow/depth variants are created by their actual passes, not by color
    // compilation alone. Submit once while offscreen geometry is still included.
    // The loading screen covers this frame, including first texture uploads.
    renderFrame?.();
  } finally {
    for (const [object, previous] of culling) object.frustumCulled = previous;
  }
}
