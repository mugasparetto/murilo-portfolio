// outlineStore.ts
import { create } from "zustand";
import * as THREE from "three";

type State = {
  outlined: THREE.Object3D[];
  setOutlined: (objs: THREE.Object3D[]) => void;
  clearOutlined: () => void;
};

export const useStore = create<State>((set) => ({
  outlined: [],
  setOutlined: (outlined) => set({ outlined }),
  clearOutlined: () => set({ outlined: [] }),
}));
