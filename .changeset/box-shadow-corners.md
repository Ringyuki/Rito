---
'@ritojs/core': patch
---

Box shadows paint as Chromium paints them. A box whose corners are rounded differently (`border-radius: 0 8px 8px 8px`, a speech bubble) cast a square-cornered shadow that showed past its rounded corners; the shadow now takes each corner's radius. A spread shadow on a square box stays square instead of rounding by the spread, and a corner smaller than the spread grows by the CSS corner correction. The shadow is cut out along the box's own rounded outline, one pixel inside an opaque background, so no thin grey line shows along the box's edges. And only the blurred shadow paints: the shape it is cast from was also drawn, unblurred, as a hard ring around any box with a spread, and a translucent shadow colour was applied twice, so such shadows painted too light.
