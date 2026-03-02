const SLIDER_SIZE = 40;

function calculateStrength(sliderX, sliderY, zoneRect, innerWidth) {
  const sliderCenterX = sliderX + SLIDER_SIZE / 2;
  const sliderCenterY = sliderY + SLIDER_SIZE / 2;

  const zoneCenterX = zoneRect.width / 2;
  const zoneCenterY = zoneRect.height / 2;

  const distX = Math.max(0, Math.abs(sliderCenterX - zoneCenterX) - zoneRect.width / 2 + SLIDER_SIZE / 2);
  const distY = Math.max(0, Math.abs(sliderCenterY - zoneCenterY) - zoneRect.height / 2 + SLIDER_SIZE / 2);
  const distance = Math.sqrt(distX * distX + distY * distY);

  const isOutside = distance > 0;

  const maxDistX = Math.max(zoneRect.left, innerWidth - zoneRect.right) || 1;
  const normalizedDist = Math.min(distX / maxDistX, 1);

  return { isOutside, distX, maxDistX, normalizedDist };
}

const innerWidth = 1000;
// Slider is at fixedX = 500, fixedY = 100
let fixedX = 500;
let fixedY = 100;

console.log("Window at LEFT");
let zoneRectL = { left: 0, right: 270, top: 300, bottom: 420, width: 270, height: 120 };
let relXL = fixedX - zoneRectL.left;
let relYL = fixedY - zoneRectL.top;
console.log(calculateStrength(relXL, relYL, zoneRectL, innerWidth));

console.log("Window at RIGHT");
let zoneRectR = { left: 730, right: 1000, top: 300, bottom: 420, width: 270, height: 120 };
let relXR = fixedX - zoneRectR.left;
let relYR = fixedY - zoneRectR.top;
console.log(calculateStrength(relXR, relYR, zoneRectR, innerWidth));
