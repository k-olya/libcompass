# Source organization

- Put public operations on CAD math objects (solids, sketches, curves, planes,
  and topology) in `src/operations/`, such as `extrude`. Operations take named
  options objects and are re-exported from `src/index.ts`.
- Reserve `src/util/` for general helpers on other data, such as `functionalize`
  and the packed-coordinate `transformMat4` utility. These are distinct from CAD
  operations and may use positional arguments.
- Put private geometry implementation helpers in `src/internal/`; they are not
  public operations or general utilities. Keep math-object classes and interfaces
  in `src/`, with constructor shorthands beside their classes.
- Put shared default objects in `src/defaults/` and re-export them from the root.
  Defaults are instances or values, not constructor shorthands. Treat shared
  defaults and their coordinate arrays as immutable. Plane names specify local
  axis order: `XY` uses X/Y, `ZX` uses Z/X, and `YZ` uses Y/Z. `X`, `Y`, and `Z`
  are unit vectors, not axis classes.
- Keep API documentation grouped into Classes (including interfaces and types),
  Shorthands, Operations, Defaults, and Util, matching these distinctions.
  Classify public operations and defaults from their module locations.

# Geometry conventions

- Active development uses standalone math objects: sketches, planes, and explicit
  vertices, edges, and faces. These objects do not inherit from `Node` or `Memo`.
- Sketches may contain multiple closed profiles, holes, and islands. Use nesting
  (even-odd fill) to determine material. Points and infinite lines are construction
  geometry and do not bound a profile.
- Extrusion takes a finite, nonzero signed `length` and an optional finite,
  nonzero `axis` defaulting to the sketch plane normal. Normalize the axis
  internally without mutating it; displacement is `normalize(axis) * length`.
  Negative lengths reverse extrusion. The axis must leave the sketch plane.
- Public modeling angles use degrees. Public names such as `angle` and
  `rotation` may omit the `DEG` suffix; all internal angular variables and
  parameters must end in `DEG` or `RAD`, including aliases of public properties.
  Convert degrees to radians at trigonometric or matrix API boundaries. Curve
  parameters `t` remain normalized to [0, 1]; unit vectors and trigonometric
  ratios are not angles. Keep mathematical constants such as `PI` unchanged.
- Extrusion's optional `angle` is a constant wall draft angle in degrees,
  strictly between -90 and 90,
  defaulting to zero. Positive expands material (shrinking holes), negative
  contracts it (growing holes), independently of the length sign. Clamp the
  whole extrusion at the first profile's point convergence and retain a shared
  apex vertex, without a zero-area cap or degenerate triangles. Report other
  offset intersections, folds, and sharp curved joins requiring trimming.
- Keep drafting independent of curve types. Use `PlanarCurve.tangent(t)`;
  its default uses finite differences and exact evaluators or overrides are
  allowed. Curve sampling overrides remain authoritative for draft analysis
  and tessellation; never replace a curve's equations with its polyline.
- Sweep with `extrudeAlongCurve({ sketch, curve })` only along smooth regular
  paths. Local (0, 0) follows the path; align the sketch normal to its tangent
  and transport the in-plane axes with minimal twist. Correct residual rotation
  for smooth closed paths and omit caps and physical seam edges there.
- Keep a sweep's geometry parametric. Sampling stations are analysis/mesh data,
  never intermediate solid edges or faces. Reject detected corners, cusps,
  folds, self-intersections, nonmanifoldness, and unresolved numerical checks.
  Numerical midpoint checks cannot certify arbitrary hidden oscillations.
- `SpatialSurface` is a general at(u, v) surface; `RuledSurface` is its linear
  rim/apex specialization. `Surface.boundaryLoops` lists physical boundaries,
  possibly none for a closed periodic surface; only `Face` has outer/holes.
  Refine both surface parameters and synchronize shared boundaries during
  tessellation. Periodic seams must share mesh coordinates without adding edges.
- Preserve shared vertex and edge identities in solids so topology can be reused
  for further operations. Curves remain mathematical through extrusion. Profile
  analysis may use temporary sampled polylines; triangulation generates the
  output facets at a library-wide target deviation of 0.001.
  Solids contain planar faces and spatial surfaces, sharing exact edge and
  spatial-curve boundaries. Only planar faces can supply sketch planes.
- Use the same default sampling rule for every planar or spatial curve without
  a sampling override: start with normalized parameters `[0, 0.5, 1]`. For each
  interval `[a, b]`, compare `at((a + b) / 2)` with the midpoint of the line
  segment joining `at(a)` and `at(b)`. Bisect the interval and recursively test
  both halves until this Euclidean distance is less than or equal to
  `TRIANGULATION_RESOLUTION` (currently `0.001`). Resolution limits midpoint
  deviation, not segment length.
- Curve classes may override `.sample()`, for example to account for oscillations
  that midpoint probes can miss. Every operation needing curve samples must
  consume the curve's `.sample()` result, respecting overrides rather than
  introducing curve-type special cases or independent sampling rules. Lifting
  planar samples into 3D maps the sampled points through the placement plane.
- Keep sampling utilities behind the curve methods: only the default sampling
  implementations in curve classes may call `curveParameters()`. Consumers,
  including profile analysis, face validation, tessellation, and planar-to-spatial
  sample lifting, must call `.sample()`. Do not bypass overrides by calling
  `curveParameters()` or `.sampleParameters()` directly, or by constructing a
  polyline with independent `at(t)` probes. Parameter selection belongs inside
  the curve's sampling implementation. `sampleWithParameters()` is an allowed
  wrapper: it must call `.sample()` and retain its points and normalized t
  metadata. Sampling overrides used by sweeps return `this.at(t)` points;
  missing or unordered metadata must throw, never infer t from sample indices.

# Earlier node prototypes

The tree-based API is retained but development is on hold. The following rules
apply only to those node classes:

- Every node class that produces actual triangle geometry must inherit from
  `Memo`, directly or indirectly.
- Geometry-producing subclasses override the protected `triangulateUncached()`
  method. Keep `Memo.triangulate()` as the public entry point so results remain
  cached until `refresh()` is called.
- `refresh()` invalidates only that node's cache and recomputation is lazy.
  After changing geometry or children, explicitly refresh affected memoized nodes,
  including cached ancestors. It does not refresh descendants or ancestors.
