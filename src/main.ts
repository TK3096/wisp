import { Application } from "pixi.js";

async function init() {
  const app = new Application();

  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  document.body.appendChild(app.canvas);

  // Resize to fill the window on resize events
  window.addEventListener("resize", () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  });
}

init();
