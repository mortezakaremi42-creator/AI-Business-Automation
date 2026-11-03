# Survive the Apocalypse

Original procedural, stylized 3D stick-figure short. No narration, subtitles, or branding.

- Runtime: 192 seconds (3:12)
- Delivery: vertical 720 × 1280, 24 fps, H.264 / AAC stereo
- Geometry rendered at 540 × 960, upscaled to delivery resolution
- Completely black unlit character material throughout
- Original synthesized score and designed sound effects; not recorded location Foley
- Three.js geometry, keyframed camera and procedural limb animation

This is a stylized low-poly animation, not a photorealistic or studio-quality character production. Scenes use simple transitions and approximate survival actions.

`film.js` exports the deterministic `window.frame(seconds)` renderer. Serve it alongside Three.js ES modules (`three.module.js` and `three.core.js`) and capture 24 frames per second. `generate_audio.py` requires NumPy and generates the original stereo soundtrack. Its output path can be changed for another workstation.
