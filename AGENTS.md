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
- Keep API documentation grouped into Classes (including interfaces and types),
  Shorthands, Operations, and Util, matching these distinctions. Classify public
  operations from their `operations/` module location.

# Geometry conventions

- Active development uses standalone math objects: sketches, planes, and explicit
  vertices, edges, and faces. These objects do not inherit from `Node` or `Memo`.
- Sketches may contain multiple closed profiles, holes, and islands. Use nesting
  (even-odd fill) to determine material. Points and infinite lines are construction
  geometry and do not bound a profile.
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
  the curve's sampling implementation.

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
