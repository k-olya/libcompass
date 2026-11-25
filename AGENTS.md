# Source organization

- Put public operations on CAD math objects (solids, sketches, curves, planes,
  and topology) in `src/operations/`, such as `extrude`. Operations take named
  options objects and are re-exported from `src/index.ts`. Approved single-required
  parameter APIs additionally accept that value directly, preserving their options
  forms. Distinguish the forms by type, class or the named wrapper field; do not
  guess between optional settings. Constructor shorthands and their constructors
  must accept the same argument forms.
- Reserve `src/util/` for general helpers on other data, such as `functionalize`
  and the packed-coordinate `transformMat4` utility. These are distinct from CAD
  operations and may use positional arguments.
- Put private geometry implementation helpers in `src/internal/`; they are not
  public operations or general utilities. Keep math-object classes and interfaces
  in `src/`, with constructor shorthands beside their classes.
- Put shared default objects in `src/defaults/` and re-export them from the root.
  Defaults are instances or values, not constructor shorthands. Treat shared
  defaults and their coordinate arrays as immutable. Plane names specify local
  axis order: `XY` uses X/Y, `ZX` uses Z/X, and `YZ` uses Y/Z. `X`, `Y`, `Z`,
  `negX`, `negY`, and `negZ` are unit `SpatialLine` instances with zero origins;
  `negX`, `negY`, and `negZ` point along the corresponding negative world axes.
  SpatialLine is a vec3-compatible direction array with a copied origin;
  a straight extrusion ignores its origin; rotational extrusion uses it.
  `center` is the shared local Point `{ x: 0, y: 0 }`; `origin` is the shared
  world-space zero vec3 `[0, 0, 0]`.
- Keep API documentation grouped into Classes (including interfaces and types),
  Shorthands, Operations, Defaults, and Util, matching these distinctions.
  Classify public operations and defaults from their module locations.
- Rotate/displace return new mathematical objects, never mutate source geometry,
  shared defaults or memo caches. Rotate about a SpatialLine's origin and normalized
  direction, using signed degrees; displacement uses its vector without normalization.
  Preserve shared vertices/boundaries, curve/surface sampling overrides, parameter
  charts, periodicity and orientation. Transform solid child geometry lazily under
  new transform nodes without changing source child nodes.
- Displacement/rotation/curve arrays return ordinary arrays of fresh transformed copies,
  including a fresh zero-offset copy. Use width = N * offset (endpoint excluded),
  deriving a missing count by flooring width / offset with roundoff tolerance.
  Displacement uses a normalized direction; rotation uses degrees about a SpatialLine,
  defaulting to a full turn when only N or offset is given. Flatten nested targets
  recursively into the output, in repetition-major, depth-first order. SpatialLine
  is a geometry leaf despite extending Array; never flatten it into numbers.
  Curve arrays use sampled arc length for spacing and evaluate positions on the
  original SpatialCurve, respecting sample() overrides. With only N or offset,
  default width to the full sampled path length; reject extents beyond the path.
  Negative spacing traverses from end to start. Place the target's world origin
  on the path and align local Z with the travel tangent using the same smooth,
  minimal-twist frames and closed-loop correction as extrudeAlongCurve. The
  follow option defaults to false; false keeps original orientations and must not
  require tangents or smooth-path frame validation.

# Geometry conventions

- `Sketch.add` and `Node.add` accept mixed individual objects and readonly arrays,
  flattening array arguments one level in order. Append without spreading into
  `push` or another function call so large arrays do not exceed argument limits.
- Active development uses standalone math objects: sketches, planes, and explicit
  vertices, edges, and faces. These objects do not inherit from `Node` or `Memo`.
- Sketches may contain multiple closed profiles, holes, and islands. Use nesting
  (even-odd fill) to determine material. Points and infinite lines are construction
  geometry and do not bound a profile.
- `svgPath` delegates SVG commands and geometry to browser APIs, keeping path
  elements detached. Split only moveto boundaries to detect gaps, preserving
  relative current points and connected sections. Return one PlanarCurve or an
  array across gaps; bake copied 2D scale and position into the evaluator.
- `measure` accepts finite math geometry, excluding infinite objects and generic
  nodes. Use curve sample() overrides and current-resolution surface tessellation
  for approximate bounds/length/area/volume. Homogeneous measurement arrays combine
  bounds and sum quantities per entry, without boolean union. Sketches use world
  placement and ignore infinite construction lines. Solid measurements exclude
  child nodes and do not change memo caches. Return a snapshot and log it once;
  hosts can provide the log callback for their script console.
- During extrusion profile assembly, join connected open PlanarCurves and line
  segments whose oriented endpoint tangents agree into exact piecewise curves. Smooth runs may
  remain open or close into loops; already-closed input curves never join other
  curves, even at coincident endpoints. Keep sharp corners/cusps as physical
  joins, preserve purely straight runs and their intermediate vertices, preserve
  source sampling overrides and normalized parameter metadata,
  and leave the source sketch unchanged. Do not add curve-type special cases.
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
- Change resolution through `setTriangulationResolution`; never snapshot the
  mutable export in long-lived sampling defaults. Sampling caches must be keyed
  by resolution. Changing it does not invalidate memo nodes: rerun operations
  for a new model, as the app does on resolution edits.
- Keep drafting independent of curve types. Use `PlanarCurve.tangent(t)`;
  its default uses finite differences and exact evaluators or overrides are
  allowed. Curve sampling overrides remain authoritative for draft analysis
  and tessellation; never replace a curve's equations with its polyline. Preserve
  source sample parameters and evaluate tangents there. Refine paired draft rims
  only when the actual source or offset midpoint deviation exceeds resolution;
  do not tighten the tolerance just because the draft angle is nonzero.
- Sweep with `extrudeAlongCurve({ sketch, curve })` only along smooth regular
  paths. Local (0, 0) follows the path; align the sketch normal to its tangent
  and transport the in-plane axes with minimal twist. Correct residual rotation
  for smooth closed paths and omit caps and physical seam edges there.
- Keep a sweep's geometry parametric. Sampling stations are analysis/mesh data,
  never intermediate solid edges or faces. Reject detected corners, cusps,
  folds, self-intersections, nonmanifoldness, and unresolved numerical checks.
  Numerical midpoint checks cannot certify arbitrary hidden oscillations.
- Rotational extrusion (`extrudeRotate`) preserves the sketch's world-space
  placement and revolves it about a coplanar SpatialLine, using both the origin
  and normalized direction. Angle uses signed degrees, defaults to 360, and has
  magnitude in (0, 360]. Share parametric sweep construction and validation;
  reverse wall/cap orientation when travel opposes the sketch normal. Full turns
  are periodic without caps or seam edges; partial turns have planar caps.
  Respect source sampling overrides and shared boundary identities. Currently
  require all profiles on one side of the axis, allowing boundary contact.
  Share stationary axis vertices as poles, omit collapsed trajectory boundaries
  and zero-area axis walls, and share the unchanged axis edge between partial-turn
  caps. Retain pole identities through evaluation and transforms. Reject crossing,
  nonmanifold pinches, noncoplanar axes and unresolved geometry explicitly.
- `SpatialSurface` is a general at(u, v) surface; `RuledSurface` is its linear
  rim/apex specialization. `Surface.boundaryLoops` lists physical boundaries,
  possibly none for a closed periodic surface; only `Face` has outer/holes.
  Refine both surface parameters and synchronize shared boundaries during
  tessellation. A shared boundary may run forward or backward on each surface:
  preserve that direction in parameter synchronization and mesh vertex order,
  including nonuniform sample overrides. Retain original sample vertices and
  evaluate additional synchronized stations on the exact boundary; never place
  them on a coarser sampled chord or infer parameters from sample indices.
  These stations come from adjoining samplers, not independent curvature probes.
  Periodic seams must share mesh
  coordinates without adding edges.
- Preserve shared vertex and edge identities in solids so topology can be reused
  for further operations. Curves remain mathematical through extrusion. Profile
  analysis may use temporary sampled polylines; triangulation generates the
  output facets at the configured library-wide target deviation.
  Solids contain planar faces and spatial surfaces, sharing exact edge and
  spatial-curve boundaries. Only planar faces can supply sketch planes.
- Chamfer returns a new solid, retaining child node identities in a new child
  array. Never mutate input coordinates, topology, child lists, or memo caches.
  Resolve boundary selections through the shared `searchBoundaries` operation:
  accept one selector or a mixed list of original boundary indices/objects, this solid's planar Face objects
  (including hole boundaries), and predicates. Test each boundary with every
  adjoining planar Face; any match includes it. If there is no adjoining Face,
  call once with `face: undefined`. Deduplicate results by identity, preserve
  first-match order, reject foreign topology, and exclude child nodes. Omitted
  or empty lists select all; a selector or nonempty list with no matches selects none.
  Round uses the same selector types and helper. Setback and angle reference the first adjoining surface in
  solid.surfaces order. Curved trims retain the source evaluator through a
  TrimmedSurface chart or retained SurfaceRegion charts and share exact rails with the bevel. Smooth closed rims
  may combine tangent lines and curves. Convex chamfers
  cut into material, while concave chamfers fill the adjacent void (e.g. a pocket
  floor). Determine that side from retained directions and adjoining normals;
  keep positive setback length and degree angle semantics on both sides. Respect
  sampling overrides and reject unresolved intersections, folds and unsupported
  curved corners rather than falling back to a mesh-only solid.
- Round is a nonmutating constant-radius rolling-ball operation with the same
  original boundary-index selection and child/cache preservation as chamfer.
  Retain exact tangent surface evaluators and contact rails; curve types must not
  introduce operation-level special cases. Smooth closed rims can combine straight
  and curved sections. Convex rounds intersect inward radius offsets and remove
  material; concave rounds intersect outward offsets and add material, including
  pocket floors. Determine the side from adjoining surface normals and retained
  surface directions. Three rounded planar edges meet in a spherical corner.
  At the radius limit, remove zero-area faces/edges, share coincident rails, and
  retain singular pole vertices without emitting degenerate triangles. Preserve
  source sampling overrides. Planar-edge rounding is local: require planar adjoining
  faces and supported corners only in the affected neighborhood, and classify
  convexity from the local retained side rather than whole-solid halfspaces.
  Preserve unrelated curved surfaces, distant hole trims and unchanged topology
  by identity while trimming affected faces. Preserve original curved boundary
  identities through the planar stage so straight edges and smooth rims can round
  together in one operation. Reject interference with other trims rather than
  deleting features. Analytic straight rounds use signed inward/outward offsets
  for convex/concave edges and same-sense three-edge spherical corners. Numerical
  rounds accept closed rims and open straight/curved boundaries between regular
  planar/spatial surfaces. Open ends share closing arcs with planar caps and trim
  their neighboring boundaries; intersect oblique caps where source charts permit.
  Retry only explicit UnsupportedRoundError capability gaps, from original geometry
  with fresh topology; never mask invalid radii, collisions or unresolved geometry.
  Preserve native directions and sampler parameters through source-chart trims.
  Closed, noncollapsing rims on boolean SurfaceRegions support both operations,
  including oblique planar cuts; retain unrelated trims and original source charts.
  Reject unsupported corners, overlaps and unresolved
  intersections explicitly rather than substituting faceted geometry.
- Geometric trims take cutting geometry, not parameter ranges: `trimCurve`
  retains the interval containing an original normalized `keep` parameter;
  `trimSurface` returns connected retained surface patches, selecting a plane's
  positive/negative side or a closed planar cutter's inside/outside region.
  Closed face cutters use the Face's local XY frame. Preserve source equations,
  source sampling overrides, shared cut vertices and unchanged boundary objects.
  Sampling discovers intersections and classifies regions; refine cut points
  against the original equations. Reject coincident, ambiguous or unresolved
  arrangements. Spatial-surface cuts must fit supported regular charts; never
  substitute a mesh or silently discard an unsupported component. Trimming an
  individual surface does not cap it or turn it into a closed solid.
- Solid booleans are regularized, nonmutating operations: `intersect` retains
  shared volume; `difference` removes the tool volume. Inputs must have closed,
  consistently oriented manifold own surfaces; child nodes are excluded from
  geometry and the first operand's children are retained in a fresh child array.
  Empty results use `new Solid({ surfaces: [] })`. `extrudeCut` is exactly
  `difference({ solid, tool: extrude(options) })`, with ordinary signed length,
  normalized axis and degree draft semantics; never extend the cut implicitly.
  Preserve mathematical surfaces and sew shared exact boundary objects, reversing
  tool walls in differences. Temporary meshes may discover intersections,
  classify regions and validate closure, never replace result surfaces. General
  surface intersections refine discovery seeds against both source evaluators
  and retain one shared SpatialCurve with a continuous parameter lift on each
  surface. SurfaceRegion represents arbitrary retained UV loops, holes and
  periodic chart pieces; internal chart seams are not physical boundaries.
  Preserve source sampling overrides and split curves only at topological events,
  not at discovery stations. Trimmed results must remain usable in later booleans.
  Tessellate retained regions with a curvature-aware parameter metric: preserve
  long triangles along straight surface directions instead of refining them to
  match curved directions. Intersection discovery stations are sampling checks,
  not mandatory output vertices; retain them only when chord deviation requires
  it. Use geometric chord lengths for intersection parameter predictors so an
  irregular analysis mesh does not create artificial sampling density.
  Reject singular, branching/tangent and unresolved arrangements explicitly. Do
  not return a partial, open or faceted result when sewing or validation fails.
- Use the same default sampling rule for every planar or spatial curve without
  a sampling override: start with normalized parameters `[0, 0.5, 1]`. For each
  interval `[a, b]`, compare `at((a + b) / 2)` with the midpoint of the line
  segment joining `at(a)` and `at(b)`. Bisect the interval and recursively test
  both halves until this Euclidean distance is less than or equal to
  `TRIANGULATION_RESOLUTION` (default `0.0128`, configurable from `0.001` to `1`
  through `setTriangulationResolution`). Closed curves retain at least four
  segments so coarse settings do not collapse their profile polylines. Resolution
  limits midpoint deviation, not segment length.
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
  metadata. Sampling overrides used by drafts or sweeps return `this.at(t)` points;
  missing or unordered metadata must throw, never infer t from sample indices.

# Earlier node prototypes

The tree-based API is retained but development is on hold. The following rules
apply only to those node classes:

- AnnotatedNode extends Memo and adds name, color, and alpha. Omitted names
  become mesh1, mesh2, ... from a hidden module counter; only successful unnamed
  constructions increment it. Alpha defaults to 1. Color defaults to 'default'
  from the immutable 16-entry `colors` palette and accepts only palette names
  or #RGB/#RRGGBB strings, including property assignments. Resolve names to hex;
  do not accept arbitrary CSS names/functions or RGB numbers.
  `annotate({ solid, name?, color?, alpha? })` and `solid.annotate()`
  create a new wrapper retaining the original solid. Annotations do not alter
  geometry or STL exports. The app renders nearest-annotated subtrees separately,
  excluding nested annotated geometry from ancestor meshes. Keep own triangles
  before child triangles in insertion order so world-space mesh ranges retain
  transforms and shared child occurrences without duplicating geometry.

- Every node class that produces actual triangle geometry must inherit from
  `Memo`, directly or indirectly.
- Geometry-producing subclasses override the protected `triangulateUncached()`
  method. Keep `Memo.triangulate()` as the public entry point so results remain
  cached until `refresh()` is called.
- `refresh()` invalidates only that node's cache and recomputation is lazy.
  After changing geometry or children, explicitly refresh affected memoized nodes,
  including cached ancestors. It does not refresh descendants or ancestors.
