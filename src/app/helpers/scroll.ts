import { MathUtils } from "three";

export const easeCos = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);

// Convert weights (e.g. [0.25,0.5,0.25]) into cumulative ranges in 0..1
export const makeRanges = (weights: number[]) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w) => {
    const start = acc;
    acc += w / sum;
    return { start, end: acc };
  });
};

// Local eased progress for segment i
export const segmentProgress = (
  t: number,
  ranges: { start: number; end: number }[],
  i: number
) => {
  const r = ranges[i];
  const local = (t - r.start) / (r.end - r.start);
  return easeCos(MathUtils.clamp(local, 0, 1));
};
