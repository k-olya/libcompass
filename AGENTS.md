# Geometry conventions

- Active development uses standalone math objects: sketches, planes, and explicit
  vertices, edges, and faces. These objects do not inherit from `Node` or `Memo`.
- Sketches may contain multiple closed profiles, holes, and islands. Use nesting
  (even-odd fill) to determine material. Points and infinite lines are construction
  geometry and do not bound a profile.
- Preserve shared vertex and edge identities in solids so topology can be reused
  for further operations. Circles remain analytic through extrusion. Only
  triangulation facets curves, at a library-wide chord deviation of 0.001.
  Solids contain planar faces and spatial surfaces, sharing exact edge and
  spatial-curve boundaries. Only planar faces can supply sketch planes.

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
