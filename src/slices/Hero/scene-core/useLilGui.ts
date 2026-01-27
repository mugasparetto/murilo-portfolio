"use client";

import { useEffect } from "react";
import GUI from "lil-gui";
import type { SceneParams } from "./params";

type Callbacks = {
  onCameraChange: () => void;
  onRebuildTerrain: () => void;
  onStepsChange: () => void;
  onDoorChange: () => void;
  onGroupChange: () => void;
  onFluidChange: () => void;
};

export function useLilGui(params: SceneParams, cb: Callbacks) {
  useEffect(() => {
    const gui = new GUI();

    gui.close();

    const camFolder = gui.addFolder("camera");
    camFolder.add(params, "cameraX", -3000, 3000).onChange(cb.onCameraChange);
    camFolder.add(params, "cameraY", -3000, 3000).onChange(cb.onCameraChange);
    camFolder.add(params, "cameraZ", -1000, 5000).onChange(cb.onCameraChange);
    camFolder.add(params, "fov", 20, 120).onChange(cb.onCameraChange);
    camFolder.close();

    const targetFolder = gui.addFolder("look at");
    targetFolder
      .add(params, "targetX", -2000, 2000)
      .onChange(cb.onCameraChange);
    targetFolder
      .add(params, "targetY", -2000, 2000)
      .onChange(cb.onCameraChange);
    targetFolder
      .add(params, "targetZ", -2000, 2000)
      .onChange(cb.onCameraChange);
    targetFolder.close();

    const terrainFolder = gui.addFolder("terrain");
    terrainFolder
      .add(params, "w", 400, 20000, 10)
      .onFinishChange(cb.onRebuildTerrain);
    terrainFolder
      .add(params, "h", 400, 20000, 10)
      .onFinishChange(cb.onRebuildTerrain);
    terrainFolder
      .add(params, "scl", 10, 200, 1)
      .onFinishChange(cb.onRebuildTerrain);

    terrainFolder.add(params, "diff", 0, 1200, 1);
    terrainFolder.add(params, "xyScale", 0.0005, 0.05, 0.0001);
    terrainFolder.add(params, "scrollSpeed", 0, 600, 1);
    terrainFolder.add(params, "speedMul", 0, 5, 0.01);
    terrainFolder.add(params, "lineWidth", 0.5, 8, 0.01);

    terrainFolder.add(params, "edgePower", 0.5, 8, 0.01);
    terrainFolder.add(params, "edgePad", 0, 3500, 1);
    terrainFolder.add(params, "edgeStrength", 0, 5, 0.01);

    terrainFolder.add(params, "bowlStrength", 0, 800, 1).name("bowl strength");
    terrainFolder.add(params, "bowlPower", 1, 6, 0.01).name("bowl power");
    terrainFolder
      .add(params, "noiseEdgeStart", 0.0, 0.9, 0.01)
      .name("noise start");
    terrainFolder
      .add(params, "noiseEdgePower", 0.5, 6.0, 0.01)
      .name("noise power");

    terrainFolder
      .add(params, "maskNearZ", -10000, 1000, 10)
      .name("mask near z");
    terrainFolder.add(params, "maskFarZ", -15000, 1000, 10).name("mask far z");
    terrainFolder.add(params, "maskPower", 0.2, 6.0, 0.01).name("mask power");
    terrainFolder.add(params, "useHardClip", 0, 1, 1).name("hard clip");

    terrainFolder.close();

    const stepFolder = gui.addFolder("steps");
    stepFolder.add(params, "stepX", -4000, 1000, 10).onChange(cb.onStepsChange);
    stepFolder.add(params, "stepY", 0, 2000, 1).onChange(cb.onStepsChange);
    stepFolder.add(params, "stepZ", -4000, 2000, 10).onChange(cb.onStepsChange);
    stepFolder
      .add(params, "rotY", -Math.PI, Math.PI)
      .onChange(cb.onStepsChange);
    stepFolder
      .add(params, "rotZ", -Math.PI, Math.PI)
      .onChange(cb.onStepsChange);
    stepFolder.open();

    const doorFolder = gui.addFolder("door");
    doorFolder.add(params, "doorX", -2000, 2000).onChange(cb.onDoorChange);
    doorFolder.add(params, "doorY", 0, 4000).onChange(cb.onDoorChange);
    doorFolder.add(params, "doorZ", -6000, 6000, 5).onChange(cb.onDoorChange);
    doorFolder.add(params, "doorScaleX", 1, 10).onChange(cb.onDoorChange);
    doorFolder.add(params, "doorScaleY", 1, 10).onChange(cb.onDoorChange);

    const groupFolder = gui.addFolder("group");
    groupFolder
      .add(params, "groupY", -2000, 2000, 50)
      .onChange(cb.onGroupChange);

    const fluidFolder = gui.addFolder("fluid");
    fluidFolder.addColor(params, "color1").onChange(cb.onFluidChange);
    fluidFolder.addColor(params, "color2").onChange(cb.onFluidChange);
    fluidFolder.addColor(params, "color3").onChange(cb.onFluidChange);
    fluidFolder.addColor(params, "color4").onChange(cb.onFluidChange);

    return () => {
      gui.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
