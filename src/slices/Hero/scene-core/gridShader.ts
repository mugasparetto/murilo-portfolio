/**
 * The terrain's grid, factored out so anything that should read as the same
 * material can draw literally the same lines: the ground in <Terrain /> and the
 * box faces in <Steps />.
 */

/** grid cells across one terrain tile, on both axes */
export const TERRAIN_GRID = 40;

/**
 * Where the terrain puts its lines across x, as a coordinate in cells: lines
 * land wherever this hits a half-integer. Anything that has to line up with the
 * ground has to be built on the same expression — matching cell *sizes* is not
 * enough, the phase has to agree too.
 *
 * Mirrors `vGridUv.x * uGrid` in terrainVertex/terrainFragment.
 */
export const gridColumnCoord = /* glsl */ `
  uniform float uGridWidth;    // terrain tile width — the span uGrid divides
  uniform float uGrid;         // cells across it
  uniform float uGridOffset;   // manual nudge along x, in world units

  float gridColumn(float worldX) {
    return ((worldX - uGridOffset) / uGridWidth + 0.5) * uGrid;
  }
`;

export const gridFunctions = /* glsl */ `
  // Anti-aliased grid line factor for one axis:
  // returns 0 on lines, 1 in cell interiors (so it matches your mix()).
  // Lines land on half-cells, i.e. wherever fract(g) == 0.5.
  float gridLineFactor(float g, float lineWidth) {
    // distance to the nearest grid line (0 at lines)
    float f = abs(fract(g) - 0.5);

    // derivative for AA — this is what keeps the line a constant width on
    // screen however the surface is angled
    float df = fwidth(g);

    return smoothstep(0.0, df * lineWidth, f);
  }

  // Both axes: a line on either one wins.
  float gridFactor(vec2 uv, vec2 grid, float lineWidth) {
    vec2 g = uv * grid;
    return min(
      gridLineFactor(g.x, lineWidth),
      gridLineFactor(g.y, lineWidth)
    );
  }
`;
