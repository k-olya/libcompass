# libcompass

The CAD library behind compassts, built from sketches, reusable boundary topology,
and a scene graph. Extrusions return solids with exact curves, edges, and surfaces;
each solid is also a memoized node that can be added directly to a scene or
transform. Triangulation produces WebGL-compatible `Float32Array` XYZ triangle
positions. Applications provide their own UI, visualizer, exporters, or API.
Runtime dependencies are `gl-matrix` for vector math and `earcut` for polygon triangulation.

```sh
npm ci
npm run build
npm test
```

`src/` contains library code, `test/` contains Node.js tests, and `dist/` contains
compiled ES modules, declarations, and source maps. Development requires Node.js
22 or later. Modules have no side effects and can be imported individually:
`libcompass/Sketch`, or `libcompass/src/Sketch.ts` for apps compiling source.
Public API declarations retain their TSDoc descriptions, parameters, examples,
and error conditions. Compassts uses this source to generate its documentation
browser and Monaco type environment. Rebuild the library after source changes
to keep the runtime in sync with those declarations.

Tests cover geometry validation, holes and nested profiles, outward winding and
watertight meshes, shared topology, scene composition, transforms, and explicit
cache invalidation.

## Sketch and extrude

```ts
import { Circle, Face, LineSegment, Plane, Sketch, extrude } from 'libcompass';

const sketch = new Sketch({ plane: new Plane() }); // Default plane is world XY.
const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }];
sketch.add(...corners.map((point, i) => new LineSegment({ start: point, end: corners[(i + 1) % 4] })));
sketch.add(new Circle({ center: { x: 3, y: 3 }, radius: 1 }), new Circle({ center: { x: 7, y: 3 }, radius: 1 }));

const body = extrude({ sketch, length: 8 }); // Two exact circular through holes.
const positions: Float32Array = body.triangulate();
// Equivalent: sketch.extrude({ length: 8 }).
```

Sketches support multiple disconnected profiles, concave outlines, multiple holes,
and islands nested inside holes. Nesting determines material using even-odd fill;
contour winding and segment insertion order do not matter. Segment endpoints must
match exactly by XY coordinates, whether or not they are the same `Point` object.
Points and infinite lines are construction geometry and do not create boundaries.

| Object | Definition and evaluation |
| --- | --- |
| `Point` — `{ x, y }` | An interface for a sketch-local 2D point. |
| `Vertex` — `{ position: [x, y, z] }` | An interface for a shared world-space vertex. |
| `new Line({ point, direction })` | An infinite line with a `ReadonlyVec2` direction; `at(t)` returns `point + t * direction`. |
| `new LineSegment({ start, end })` | Two endpoints; `at(0)` and `at(1)` return their coordinates. |
| `new PlanarCurve({ at, tangent, start, end })` | An exact local XY curve on [0, 1], with optional tangent evaluator and shared endpoints. |
| `new Circle({ radius })` | Optional `center` defaults to `{ x: 0, y: 0 }`. An analytic `PlanarCurve`; `at(t)` traces one counterclockwise turn on [0, 1]. |
| `new Plane({ a, b, c })` | Three noncollinear world points, each a `Vertex` or `ReadonlyVec3`. Defaults to XY. |
| `new Sketch({ plane })` | Local 2D geometry on a world-space plane; `add(...elements)` returns the sketch. |
| `new Edge({ start, end })` | A boundary edge retaining its vertex objects. |
| `new Face({ outer, holes, plane })` | A planar surface with closed loops of edges and spatial curves; holes and an oriented plane are optional. |
| `new Solid({ surfaces })` | A memoized scene node retaining shared analytic topology. |
| `new SpatialCurve({ at, start, end })` | A world-space parametric curve on [0, 1], with optional shared endpoint objects. |
| `new SpatialSurface({ at, boundaryLoops, sides, periodicU, periodicV, reversed })` | A general parametric surface on [0, 1]², with optional periodic directions. |
| `new RuledSurface({ start, end, sides, reversed })` | An exact ruled patch between corresponding boundaries, or from a boundary to an apex vertex. |
| `new TrimmedSurface({ surface, at, boundaryLoops, sides })` | A mathematical parameter chart retaining a region of an existing spatial surface. |
| `new SurfaceRegion({ surface, regions, boundaryLoops, reversed })` | An existing parametric surface retained by arbitrary trim loops, holes and periodic chart pieces. |
| `new TransformMat4({ matrix })` | A memoized scene node applying a gl-matrix transformation. |

Constructors with arguments take a single named options object. `Plane` and
`Sketch` allow omitted options for their defaults; zero-argument constructors
such as `Node`, `Memo`, and `Transform` remain unchanged. Extrusion also takes
named options: `extrude({ sketch, length, axis?, angle? })` or
`sketch.extrude({ length, axis?, angle? })`. `axis` is a finite, nonzero world-space vector,
normalized internally without modifying it, and defaults to the sketch plane
normal. Displacement is `normalize(axis) * length`; negative
lengths extrude in the opposite direction. Length must be finite and nonzero,
and the axis must leave the sketch plane. Extrusion has no tessellation options.
Utilities such as `functionalize` and `transformMat4` keep positional arguments.

`angle` is a wall draft angle in degrees, defaulting to zero, strictly between
`-90` and `90`. Positive angles expand material and shrink
holes; negative angles contract material and grow holes. This sign convention
also applies to negative lengths. A normal-axis extrusion offsets each wall by
`abs(length) * tan(degtorad(angleDEG))`, rather than scaling the whole profile. Oblique axes
also keep a constant wall angle, provided the angle permits forward-moving walls.

```ts
import { circle, sketch } from 'libcompass';

const coneSketch = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 5 }));
const frustum = coneSketch.extrude({ length: 2, angle: -45 });
const cone = coneSketch.extrude({ length: 20, angle: -45 });
// The cone stops at height 5: a shared apex replaces the upper rim and cap.
```

The whole extrusion stops at the first boundary that converges to a point, so
disconnected profiles share the clamped length. Polygon corners remain sharp;
smooth curved joins are supported. Sharp joins involving curves, offset folds,
intersecting contours, or a collapse to a line need a future offset-trimming
operation and currently throw a descriptive `RangeError`.

Draft uses the generic `PlanarCurve.tangent(t)` unit tangent. By default it uses
finite differences of `at(t)`; pass an optional `tangent: t => [dx, dy]` evaluator
or override the method for exact derivatives. `Circle` provides its exact tangent.
The extrusion operation has no curve-type special cases. Source `sample()`
overrides are respected. Draft keeps their sample parameters and uses the
curve's tangent evaluator at those parameters. It bisects intervals only when
the source or offset rim exceeds the requested midpoint deviation, sharing the
resulting parameters between both rims. A nonzero draft does not automatically
tighten the tolerance. Generated equations remain separate from those temporary
analysis and tessellation samples.

`extrudeAlongCurve({ sketch, curve })` and `sketch.extrudeAlongCurve({ curve })`
sweep all filled regions along a smooth, regular `SpatialCurve`. Local (0, 0)
follows the path, independent of the sketch plane's original position. The
plane's orientation is minimally rotated onto the starting tangent, then
transported with minimal twist. Spatial tangents use finite differences by
default, with an optional exact evaluator or method override.

```ts
const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 0.3 }));
const curve = SpatialCurve.fromPlanarCurve({
  curve: circle({ center: { x: 0, y: 0 }, radius: 2 }),
});
const torus = extrudeAlongCurve({ sketch: s, curve });
// One doubly periodic surface, no caps, seam edges, or intermediate rings.
```

Open sweeps have planar start/end caps. Smooth closed paths distribute residual
frame rotation by sampled arc length to join without a seam. The solid retains
one side surface per source profile boundary and shares longitudinal boundaries
at profile corners; sampling stations never become solid edges or faces.
Surface tessellation refines both parameters against midpoint deviation.

Sweeps reject detected corners, cusps, stationary intervals, local folds,
nonmanifold meshes, and self-intersections, rather than returning partial solids.
These are numerical checks at the library resolution, not a proof for arbitrary
user-provided equations. Features or oscillations hidden between probes require
an appropriate sampling override; unresolved sampling throws. Validation uses
a temporary mesh and an AABB hierarchy for triangle intersection checks.

`PlanarCurve.sampleWithParameters()` and `SpatialCurve.sampleWithParameters()`
return `{ t, point }` records by calling `.sample()`, including overrides.
Overrides used by drafts or sweeps must build their samples with `this.at(t)` so parameter
metadata survives; unavailable or unordered parameters throw instead of guessing
from vertex indices. Ordinary `.sample()` still returns points or vertices.

`chamfer({ solid, length = 0.5, angle = 45, boundaries = [] })` returns a new
beveled solid. The instance form is `solid.chamfer({ length, angle, boundaries })`,
or simply `solid.chamfer()` for the defaults. `boundaries` accepts mixed selectors
resolved by `searchBoundaries` (described below); omitting it or passing `[]`
affects every boundary. Length is the positive setback on the first adjoining surface in
`solid.surfaces` order (a chord distance on curved surfaces), and angle is in
degrees from that surface, strictly between 0 and 90: toward the material for
convex rims and toward the adjacent void for concave rims.
On a right-angle edge, the other setback is `length * tan(degtorad(angle))`.

```ts
const beveled = chamfer({ solid: part, boundaries: [0, 2], length: 0.5, angle: 45 });
scene.add(beveled); // The original part and its cached mesh are unchanged.
```

Convex straight edges between planar faces use analytic cutting planes, including
intersections where several bevels meet. Smooth closed curved rims are evaluated
generically: the adjoining mathematical surfaces are trimmed and joined by a
ruled bevel, including outer rims and holes on drafted extrusions. Smooth rims
may combine tangent line segments and curves. Convex bevels remove material;
concave bevels add it, including around the floor of a blind pocket. A face
selector can bevel the pocket's outer lip, inner lip and floor together. No circle
equations or faceted replacement solids are used. Input surfaces, boundaries,
vertices and coordinate arrays are not modified; child nodes are retained in a
new child array. Open curved corners, nonconvex straight corners, overlaps with
holes or unrelated curved surfaces, folds and unresolved intersections throw.
Validation uses a temporary mesh at the current resolution, with the same
numerical limitations as sweep validation. A smooth solid with no physical
boundaries, such as a torus, returns a new solid with its existing surfaces.

`round({ solid, radius = 0.5, boundaries = [] })`, or `solid.round(options)`,
returns a new solid with tangent constant-radius rounds. Boundary selectors refer
to the original solid; omit them or pass `[]` for all boundaries. No source
geometry, child nodes or cached triangulations are modified.

Both operations and their solid methods use
`searchBoundaries({ solid, boundaries })`. Pass one selector or a mixed list.
Each selector may be an index in
`solid.boundaries`, a boundary object from that array, a planar `Face` from
`solid.surfaces`, or a predicate `({ solid, face, boundary }) => boolean`.
A face expands to all its outer and hole boundaries. Predicates test every
boundary against every adjoining planar face, including it if any test matches.
For a boundary adjoining only curved surfaces, the predicate runs once with
`face: undefined`. All predicates run even when another selector already matched.

The helper returns the original boundary objects, unique by identity and in
first-match order. Indices and objects must belong to the input solid's own
topology; child solids are excluded. Invalid selectors and nonboolean predicate
results throw. A selector or nonempty list with no matches selects nothing: chamfer and round
return a fresh solid with unchanged geometry. Omitted or empty lists select all.
`BoundarySelector` and `BoundaryPredicate` are exported types.

```ts
const cap = part.surfaces.find(surface => surface instanceof Face)!;
const selected = searchBoundaries({ solid: part, boundaries: [
  0, part.boundaries[0], cap, // Overlapping selections are deduplicated.
  ({ face }) => face !== undefined && face.plane.normal[2] > 0.9,
] });
const beveled = part.chamfer({
  length: 0.5,
  boundaries: ({ boundary }) => boundary.isLoop(),
});
```

Straight edges of convex planar solids produce cylindrical blends. Three selected
edges meeting at a regular corner produce a spherical patch. Smooth closed rims
use numerical intersections of the adjoining surfaces' radius offsets: inward
for convex edges and outward for concave edges such as pocket floors. Convex
rounds remove material; concave rounds add material. Smooth rims can combine
tangent line segments and curves, as in an extruded rounded rectangle. Their
contact curves remain exact evaluators and respect source sampling overrides.
No circle-specific formulas or mesh replacement solids are used. At a radius
limit, zero-area faces and edges disappear and coincident rails are shared.
For example:

```ts
const cylinder = sketch().add(circle({ center, radius: 1 })).extrude({ length: 2 });
const sphere = cylinder.round({ radius: 1 });
const tube = sketch().add(circle({ center, radius: 3 }), circle({ center, radius: 1 }))
  .extrude({ length: 2 });
const torus = round({ solid: tube, radius: 1 });
```

The supported inputs are convex planar solids with one or three selected edges at
each affected three-face corner, or smooth closed rims with regular adjoining
surface charts, including convex lips and concave floors of blind pockets.
Single-edge ends must meet perpendicular planar caps. Open curved
corners, two-edge corner junctions, sharp nonconvex planar corners, mixed sharp corner
trims, overlaps, and unresolved offset intersections throw explicitly. Geometry
is checked for shared manifold topology and a closed, consistently oriented,
non-self-intersecting sampled mesh before the result is returned.

A shared boundary can run forward on one spatial surface and backward on the
other. Tessellation maps both sample parameters and vertex order to each surface's
direction, preserving nonuniform curve sampling overrides. This also applies when
opposing rounds meet at the limiting radius and their contact rails become one
shared boundary.

`TrimmedSurface` and `trimmedSurface` retain the source `SpatialSurface` and a
chart mapping [0, 1]² into its retained parameter region. Curved chart sides and
periodic annuli are supported, with shared physical boundaries and no seam edges.
`parameters(u, v)` returns the source UV coordinates; `at(u, v)` evaluates the
source there. Regions that cannot be represented by one regular chart need
multiple patches. Trimming preserves the original surface equations and only
tessellation produces facets. `SpatialSurface.sides` now exposes its physical
parameter-side metadata, including for `RuledSurface`.

`trimCurve({ curve, cutters, keep })` trims at intersections with cutting geometry
and returns the piece containing `keep`, a parameter on the original curve in
`[0, 1]`. Planar curves and line segments accept planar curve, segment, or
infinite-line cutters; spatial curves and edges accept world-space planes. A
plane can also cut a planar curve placed on world XY. `cutters` must contain at
least one item. A loop's retained piece may cross its original parameter seam.
The result has a fresh normalized `[0, 1]` domain; straight inputs remain straight.
A missed cutter retains the whole curve, while `keep` on a cut is ambiguous and
throws. Source objects are unchanged.

```ts
const arc = trimCurve({
  curve: circle({ center: { x: 0, y: 0 }, radius: 5 }),
  cutters: [line({ point: { x: 0, y: 0 }, direction: [0, 1] })],
  keep: 0, // The right semicircle, crossing the original circle's parameter seam.
});
```

`trimSurface({ surface, cutter, keep })` returns an array of retained connected
patches, or `[]` when everything is removed. With a world-space `Plane`, keep
`'positive'` (the default, following its normal) or `'negative'`. With a closed
`PlanarCurve`, keep `'inside'` (the default) or `'outside'`; the cutter uses a
planar `Face`'s own local XY frame. Faces can split into disconnected pieces or
gain holes. Existing unchanged boundaries are reused and new trim joins share
vertex identities. This trims individual open surfaces, without capping a solid.

```ts
const patches = trimSurface({ surface: part.surfaces[0], cutter: YZ, keep: 'positive' });
scene.add(solid({ surfaces: patches })); // Display the retained open patches.
```

For curved surfaces, plane cuts currently require one continuous intersection
rail crossing each line of an open parameter direction exactly once, away from
the ends. The result uses the same `TrimmedSurface` chart representation as
chamfers. Oblique cuts across cylinder walls are supported, including periodic
rims without seam edges. Cuts needing several charts, such as torus sections or
an interior closed contour on a curved patch, and curved cutters on spatial
surfaces currently throw. Coincident, touching or unresolved arrangements also
report errors. These are numerical operations: `sample()` locates candidate
intersections and analyzes regions; original equations refine cut points and
remain authoritative for new curves/surfaces. Sampling overrides and their
parameter metadata are preserved, including when trimming or lifting a trim.
Oscillations hidden between supplied samples cannot be certified.

`intersect({ solid, tool })` retains the two solids' common volume, while
`difference({ solid, tool })` removes the tool's volume from the first solid.
Instance forms are `part.intersect({ tool })` and `part.difference({ tool })`.
Each returns a new `Solid`, leaving both operands' topology, coordinates and
memoized triangulations unchanged. Only the operands' own surfaces participate;
the first operand's child nodes are retained unchanged in a fresh child array.
An empty result has `surfaces: []`. Face/edge/point-only contact has no shared
volume: intersection is empty and difference retains the original volume.

```ts
const common = intersect({ solid: part, tool: cutter });
const remaining = part.difference({ tool: cutter });
scene.add(remaining);
```

`extrudeCut({ solid, sketch, length, axis, angle })` and
`part.extrudeCut({ sketch, length, axis, angle })` are exactly an ordinary
`extrude` followed by `difference` with the new extrusion as the tool. The signed
length, internally normalized axis (default sketch normal), and degree draft
angle (default zero) have the same meaning as in extrusion. Cuts do not extend
automatically through the target; position the sketch and choose sufficient
length for the desired blind or through cut.

```ts
const holeSketch = sketch().add(circle({ center: { x: 5, y: 5 }, radius: 1 }));
const drilled = part.extrudeCut({ sketch: holeSketch, length: 10 });
scene.add(drilled);
```

Boolean results retain mathematical faces, curves and surface evaluators with
shared sewn boundaries, including reversed tool surfaces lining pockets and
enclosed cavities. Planar and regular parametric surface intersections support
open cuts, closed cut loops, disconnected results and periodic seams. Curved
intersections are refined against both surface equations; `SurfaceRegion`
retains the original evaluator with arbitrary parameter trim loops, holes and
multiple chart pieces. Shared rims are reused, including coincident wall regions.
The same kernel handles `extrudeCut` and subsequent booleans on trimmed results.
Singularities, branching/tangent intersections and unresolved surface sewing
report explicit errors instead of returning a partial or faceted solid.
Inputs and nonempty results must be closed, consistently oriented manifolds.
Temporary meshes discover intersections, classify regions and validate results;
they never become the output topology. These checks share the library's
numerical sampling limits: hidden oscillations require sampling overrides.

CAD operation functions perform geometric work on math objects such as sketches,
solids, and curves. They live in `src/operations/`; for example, `extrude` is
available from the root or `libcompass/operations/extrude`. The previous
`libcompass/extrude` import remains an alias. Constructor shorthands create math
objects and stay beside their classes.

General utilities live in `src/util/`: `functionalize` works with arbitrary
methods, while `transformMat4` works with matrices and packed coordinate arrays.
Private geometry implementation helpers live in `src/internal/` and are not
exported from the root API. The docs browser groups public entries into Classes,
Shorthands, Operations, Defaults, and Util.

Public modeling angles use degrees: `extrude` and `Sketch.extrude` take `angle`,
and `Transform.rotation` stores XYZ Euler angles. Curve `at(t)` parameters stay
normalized to [0, 1]. Internal angular values use `DEG` or `RAD` suffixes.

Angle helpers are exported from the root and `libcompass/util/angles`: `PI`
equals `Math.PI`, `radtodeg(angleRAD)` converts to degrees, and `degtorad(angleDEG)`
converts to radians. Conversions preserve negative angles and multiple turns;
they do not wrap or clamp. For example, `degtorad(45)` equals `PI / 4`.

Every concrete class also has a lowercase constructor shorthand, exported from the root
and its class module: `node`, `memo`, `annotatedNode`, `transform`, `transformMat4Node`, `line`,
`lineSegment`, `circle`, `plane`, `sketch`, `edge`, `face`, `solid`,
`planarCurve`, `spatialCurve`, `spatialSurface`, and `ruledSurface`. They return
ordinary class instances and accept the same options and defaults. The name
`transformMat4Node` avoids a collision with the `transformMat4` utility.

```ts
import { circle, sketch } from 'libcompass';

const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 5 }));
const body = s.extrude({ length: 10 });
```

`Point` and `Vertex` have no runtime constructors. Use plain object literals and
`import type { Point, Vertex } from 'libcompass'` for TypeScript annotations.
Geometry operations validate finite coordinates when consuming those objects.
Vertex objects and their position arrays are retained by reference; treat them
as immutable so shared topology remains consistent.

The first plane point is the origin; the first-to-second direction defines local
X, and the three-point orientation defines the normal. `plane.toWorld(point)`
returns a `Vertex`; `plane.toLocal(vertexOrVec3)` returns a `Point` and rejects
points off the plane. Extrusion vectors are in world coordinates and may be
oblique or point against the plane normal, but must have a nonzero normal component.

## Ellipses

`ellipse({ center, radiusX, radiusY, rotation })` returns an exact, counterclockwise
`PlanarCurve` loop. `radiusX` and `radiusY` are positive semi-axis lengths before
rotation (half the full width and height). `rotation` is counterclockwise in
degrees and defaults to zero. Equal radii produce a circle. For example:

```ts
s.add(ellipse({ center: { x: 0, y: 0 }, radiusX: 10, radiusY: 5, rotation: 30 }));
```

`at(0)` is the rotated positive-X semi-axis endpoint, and `at(1)` shares that
point. Ellipses provide analytic tangents and use the ordinary adaptive sampling,
profile, lifting, and extrusion paths without new curve-type cases. Nonfinite
inputs and nonpositive radii throw.

## SVG paths

`svgPath({ d, position, scale })` uses the browser's native SVG path parser and
geometry methods. It returns one `PlanarCurve`, or an array of curves when gaps
separate subpaths; connected sections remain one curve. `at(t)` follows native
normalized path length, then applies `position + scale * point` directly.
`position` defaults to `{ x: 0, y: 0 }`, and `scale` to `{ x: 1, y: 1 }`.
Negative scales mirror axes. SVG Y values are preserved unless you flip Y.

```ts
const outline = svgPath({
  d: 'M 0 0 C 0 10 10 10 10 0 Z',
  position: { x: -5, y: 0 },
  scale: { x: 1, y: -1 },
});
scene.add(sketch().add(outline).extrude({ length: 3 }));
```

This operation requires browser SVG geometry APIs; importing the library in
Node remains supported. The private path element stays detached from the DOM.
Only `d` is used, with no stroke, caps, joins, or other SVG primitives. Open
paths remain open; closed paths share their endpoint. Relative moveto commands
retain the preceding current point, including after closepath. Pass the result
directly to `sketch.add()`, which accepts both curves and arrays, including holes
and islands. Empty paths or paths with no positive-length geometry throw;
zero-length subpaths are skipped. Malformed syntax follows the browser's parser.
Sampling, lifting and extrusion use the ordinary curve methods, including their
midpoint-sampling limitations for oscillatory curves. Geometric precision is
limited by the browser's path geometry implementation.

## Circular arcs

`arc` returns a mathematical `PlanarCurve`, using the normal adaptive sampling
and analytic lifting pipeline. Choose one of four constructions:

```ts
// Circle center and endpoints, with travel direction (counterclockwise by default).
const a = arc({ center: { x: 0, y: 0 }, start: { x: 5, y: 0 },
  end: { x: 0, y: 5 }, direction: 'clockwise' });
// Endpoints and signed sweep in degrees.
const b = arc({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, angle: 180 });
// Three points on the arc; their order determines its direction.
const c = arc({ start: { x: 0, y: 0 }, through: { x: 5, y: 5 }, end: { x: 10, y: 0 } });
// Start point, circle center, and signed sweep; the endpoint is calculated.
const d = arc({ start: { x: 5, y: 0 }, center: { x: 0, y: 0 }, angle: -90 });
const s = sketch().add(b, lineSegment({ start: b.end, end: b.start }));
```

The three points in the first form are **center, start, and end**; both endpoints
must have the same positive distance from center. Direction chooses clockwise or
counterclockwise travel, including the major arc where appropriate. In the second
form positive angles travel counterclockwise and negative angles clockwise;
`0 < abs(angle) < 360`, and magnitudes over 180 create major arcs. With `through`,
three distinct, noncollinear points determine the circle and which arc to retain;
the through point need not be halfway along the arc. An optional `direction` must
agree with that point order. The fourth form uses `start`, `center`, and `angle`,
rotating start about center to calculate the endpoint; omit `end`, `through`, and
`direction` in this form. Supplying `end`, `center`, and `angle` together is ambiguous
and throws. Endpoints must be distinct; use `circle` for
a full loop. `at(t)` uses [0, 1], retains endpoint identities, and provides an
analytic tangent. An arc can join line segments or other curves to bound a profile.

## Planar segment generators

`polyline` and `rectangle` return `LineSegment[]`, with shared
endpoint objects at each join. Pass these arrays directly to a sketch's `add`:

```ts
const s = sketch();
s.add(rectangle({ corner1: { x: -20, y: 10 }, corner2: { x: 20, y: -10 } }));
const centered = rectangle({ center: { x: 5, y: 3 }, corner2: { x: 10, y: 6 } });
const triangle = polyline({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], loop: true });
```

`Sketch.add` accepts individual entities, arrays, or a mixture, including readonly
arrays: `s.add(point, segments, anotherPoint)`. Array arguments are flattened one
level in order, retaining object identities. Existing `s.add(...segments)` calls
still work; passing an array directly avoids function argument limits for large inputs.

`roundPolyline({ segments, radius = 0.5 })` rounds shared endpoints of line
segments into exact tangent circular arcs. It returns a new array of
`LineSegment | PlanarCurve` objects without modifying source segments or points.
Endpoints match by exact XY coordinates; the input may be unordered, reversed,
open, or disconnected. Unshared endpoints stay unchanged. Straight continuations
remain straight. More than two segments at one endpoint, overlapping/backtracking
rays, or insufficient segment length for both incident rounds throw. Segments
fully consumed at the radius limit are omitted, sharing a tangent point between
the adjoining arcs. Ordered input retains its traversal order and direction.
Profile intersections are checked when extruding.

```ts
const segments = rectangle({ corner1: { x: 0, y: 0 }, corner2: { x: 10, y: 6 } });
const rounded = roundPolyline({ segments, radius: 1 });
const part = sketch().add(rounded).extrude({ length: 2 });
```

Polyline joins consecutive `points`; `loop` defaults to false. With `loop: true`,
it connects the last point to the first and accepts an already repeated closing
point without adding a zero-length segment. Open polylines need at least two
points; loops need at least three. Profile validity is checked at extrusion.
`rectangle` unifies the former rectangle and center-rectangle generators. Choose
one defining set (all coordinates are in the sketch plane):

- `corner1` and `corner2`: opposite corners, in either coordinate order.
- `center` and either corner: reflect that corner about the center.
- `width` and `height`, with at most one anchor (`center`, `corner1`, or `corner2`).
  With no anchor, the center defaults to `{ x: 0, y: 0 }`. With sizes, `corner1`
  anchors the local upper-left corner, and `corner2` the local lower-right corner.

Optional `rotation` is counterclockwise in degrees about the rectangle's center,
defaulting to zero. Width and height are true side lengths along its rotated X/Y
axes, independent of the bounding box. Supplied corners are actual final corner
points: rotation does not move them. When corners define the size, project their
separation onto the rotated axes. For example:

```ts
const rotated = rectangle({ center, width: 20, height: 10, rotation: 30 });
const anchored = rectangle({ corner1: { x: 5, y: 2 }, width: 20, height: 10, rotation: 30 });
```

Extra defining points or dimensions throw, including `center` with both corners
or a corner pair with sizes. Incomplete inputs, nonpositive sizes, nonfinite
coordinates/rotation, and numerically collapsed dimensions also throw. Supplied
corners retain their object identities, and inputs are never modified. These are
operations generating existing line segments, without additional shape classes.

## Direct-argument forms

Selected APIs accept their sole required value directly. Their options-object
forms remain available whenever optional settings are needed:

```ts
const profile = circle(5);                  // circle({ radius: 5 })
const sameProfile = new Circle(5);
const outline = svgPath('M0 0L10 0L10 10Z');
const segments = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]); // Open by default.
const curve = planarCurve(t => ({ x: t, y: t * t }));
const path = spatialCurve(t => ({ position: [0, 0, 10 * t] }));
const patch = spatialSurface((u, v) => ({ position: [u, v, u * v] }));
const part = sketch().add(profile).extrude(10);
const swept = sketch().add(profile).extrudeAlongCurve(path);
const lifted = SpatialCurve.fromPlanarCurve(profile);
const moved = part.displace([10, 0, 0]);
const contained = profile.contains({ x: 0, y: 0 });
const common = part.intersect(moved);
const cut = part.difference(moved);
measure(part);                             // Logs once and returns measurements.
scene.add(annotate(part));                  // Default name, color and alpha.
```

`face(outer)` / `new Face(outer)` accept a boundary array, and
`solid(surfaces)` / `new Solid(surfaces)` accept a surface array. `PlanarCurve`,
`SpatialCurve` and `SpatialSurface` constructors also accept their evaluator
functions directly. `chamfer(part)` and `round(part)` use default settings on all
boundaries, while `searchBoundaries(part)` returns all original boundaries.
Displacement vectors may be ordinary readonly arrays or typed vectors; this
method form applies to planes, spatial lines/curves, edges, solids and surfaces.

Direct values are distinguished from options by type, class or the named wrapper
field. Standalone `extrude` still requires `{ sketch, length, ... }`; only the
sketch method can take a length alone. Likewise, optional-only methods such as
`part.round({ radius: 1 })` keep their options form. Unlisted functions retain
their existing signatures.

## Reuse the result

`Solid.surfaces` contains `Face`, `SpatialSurface` and `SurfaceRegion` instances, all extending
`Surface`. `Solid.boundaries` contains unique `Edge` and `SpatialCurve` objects,
and `Solid.vertices` contains their unique topological endpoints. Neighboring
surfaces retain the same boundary objects. Sampling never adds facets or vertices
to this topology. A circular cylinder has three surfaces, two circular boundary
loops, and two topological vertices, regardless of triangulation density.

`PlanarCurve` evaluates local XY `Point` objects, while `SpatialCurve` evaluates
world-space `Vertex` objects. `Circle` extends `PlanarCurve`: `at(0)` is local +X,
`at(0.25)` is a quarter turn, and `at(1)` returns the same closing point as `at(0)`.
For angles in degrees, use `circle.at(angleDEG / 360)`; for radians, use
`circle.at(angleRAD / (2 * PI))`. Parameters outside
[0, 1] are rejected. `planarCurve({ at: t => ({ x: t, y: t * t }) })` creates a
general procedural planar curve without tessellation.

`spatialCurveFromPlanar({ curve, plane })` is a shorthand for
`SpatialCurve.fromPlanarCurve({ curve, plane })`. It places any `PlanarCurve` on a
world-space plane (XY by default), preserving its exact evaluator and normalized
parameterization. It also accepts plain objects implementing `at(t)` and replaces
`fromCircle({ circle, plane })`. The placement frame is copied; source evaluators
retain their captured geometry, which should be treated as immutable.
`planarCurve` and `plane` on the result expose the generic local definition and
placement. Spatial curves have no shape-specific properties or copying logic.
This conversion does not sample the curve.
`SketchElement` is `Point | Line | LineSegment | PlanarCurve`, including `Circle`
through inheritance. Extrusion accepts closed planar curves and assembles open
curves and line segments into closed, unbranched profiles. Construction points and
infinite lines do not contribute to profiles.

Extrusion joins connected open `PlanarCurve`s and line segments when their endpoint coordinates
match and their tangents agree in the profile's traversal direction. A smooth
run becomes one exact piecewise curve, which may stay open or close into a loop.
Each source curve occupies an equal interval of the new [0, 1] parameter;
its equations, tangent evaluator, and sampling override are retained. Sketch
elements stay unchanged. Purely straight runs retain their intermediate vertices;
sharp joins retain their topology.
Already-closed curves never join other curves; two touching circles remain
independent loops and still fail the usual touching-profile validation.

This removes unnecessary side surfaces and seam edges, so solid boundary indices
can change for profiles containing smoothly connected curves. For example, four
quarter arcs from a fully rounded square extrude to one cylindrical wall and
two closed rims, allowing `round({ radius })` to produce a sphere just as with
a single circle. `extrudeAlongCurve` uses the same profile assembly.

`PlanarLoop` is an interface with `area()` and `contains({ point })`, describing
a simple closed boundary and its strict interior. `PlanarCurve` provides these
methods for loops; calling them on an open curve throws. Composite profiles
implement the same interface. Reversing a loop's winding does not change its
positive area or containment.

Profile area, containment, nesting, and intersection checks use temporary sampled
polylines and ordinary polygon algorithms. The original curves are retained for
extrusion into exact `SpatialCurve` boundaries and `RuledSurface` walls. Sample
points never become topological vertices or straight replacements for curves.
There are no curve-type intersection equations or circle-specific profile rules.
Analysis is approximate at the sampling resolution, so very narrow gaps, touches,
and other features smaller than that resolution may be classified differently.
Geometry captured by evaluators must remain immutable.

`SpatialBoundary` is the common interface implemented by edges and spatial curves:
`start`, `end`, `at(t)`, `sample()`, and `isLoop()`. A loop has identical start and
end coordinates; no separate `Loop` class is needed. Curve `at(t)` accepts [0, 1],
returns shared endpoint objects at zero and one, and uses the evaluator's
parameterization. It is a circumference fraction for circular curves; procedural
curves need not have constant speed. `sample()` includes both endpoints, even
for a loop. This closing-point convention applies to every curve, including
`PlanarCurve.sample()` and `Circle.sample()`: loops always repeat the closing point.
`sampleParameters({ resolution })` returns normalized parameters including zero
and one. All planar and spatial curves use the same adaptive midpoint algorithm:
start with `[0, 0.5, 1]`, then halve each interval until the distance between its
curve midpoint and chord midpoint is at most the resolution. `Circle` inherits
this sampler; it has no radius-based sampling override. Lifted curves delegate
to their planar definition. Straight edges sample only their endpoints.

`sample()` is the override point for oscillatory curves or specialized sampling.
It returns ordered points, including both endpoints and the repeated closing
point of a loop. The default maps `sampleParameters()` through `at(t)`; an
override can return its own samples without implementing parameter selection.
Lifted spatial curves delegate to the original curve's `sample()` override.

Profile analysis and tessellation both consume `sample()`. Tessellation pairs
rim polylines by sample order, inserting interpolated segment vertices as needed
to retain every supplied point and keep caps and walls watertight. For arbitrary
ruled patches this is an approximate sample-order correspondence; `at(u, v)`
retains its exact parameterization. Extrusion pairs translated copies of the same
samples. Consumers contain no curve-type special cases or independent deviation
tests.

```ts
import { Circle, Plane, SpatialCurve } from 'libcompass';

const local = new Circle({ radius: 5 });
const quarterTurn = local.at(0.25);
const rim = SpatialCurve.fromPlanarCurve({ curve: local, plane: new Plane() });
const vertices = rim.sample(); // First and last vertices are the same loop endpoint.
```

`Surface.boundaryLoops` stores physical trim loops; `boundaries` flattens them,
and `vertices` lists their unique endpoint objects. `Face.outer` and `Face.holes`
retain their planar meaning. A ruled cylinder has two rim loops without an
artificial seam. A torus can have no physical boundaries at all.
`SpatialSurface.at(u, v)` evaluates a general parametric surface, while
`RuledSurface` specializes it to linear interpolation between rims or an apex.
The old `new SpatialSurface({ start, end })` and `spatialSurface({ start, end })`
forms are now `new RuledSurface({ start, end })` and `ruledSurface({ start, end })`.

```ts
const top = body.surfaces.find((surface): surface is Face =>
  surface instanceof Face && surface.plane.normal[2] > 0.99
)!;
const nextSketch = Sketch.fromFace(top); // Empty sketch using the face's plane.
nextSketch.add(new Circle({ center: { x: 5, y: 3 }, radius: 0.5 }));
const extension = nextSketch.extrude({ length: 2 });
const blankOnTop = new Sketch({ plane: top });

const boundary = top.boundaries[0];
const midpoint = top.plane.toLocal(boundary.at(0.5));
```

Only `Face` can supply a sketch plane; `SpatialSurface` is rejected even if its
particular shape happens to be flat. `Sketch.fromFace(face)` and
`new Sketch({ plane: face })` both create empty sketches sharing the face's plane.
Neither inspects, copies, or reconstructs the face's boundaries, including holes.

Geometry coordinates and topology are exposed as readonly TypeScript properties.
Create new objects for changes; don't mutate their underlying arrays. Extrusion
creates a snapshot of the sketch. A `Solid` extends `Memo`, so it is a scene graph
node that can be added directly to scenes and transforms:

```ts
import { Node, Transform } from 'libcompass';

const scene = new Node();
const transform = new Transform().add(body);
transform.position.x = 10;
scene.add(transform);
const scenePositions = scene.triangulate();
```

Solid triangulation includes its own surfaces followed by child geometry and is
cached until `refresh()` is called. Treat cached arrays as read-only. Topology
properties describe the solid's own surfaces, excluding children.

Planar curves retain their equations through extrusion. Profile validation and
even-odd nesting use sampled polylines, without shape checks in profile assembly. Mixed curves and straight edges share endpoint vertices and vertical
edges. Straight extrusion does not triangulate during solid construction;
sweep construction additionally checks a temporary validation mesh.

`TRIANGULATION_RESOLUTION` is the library-wide midpoint-to-chord deviation in
model units. It defaults to `0.0128`; call `setTriangulationResolution(value)` with
a finite value from `0.001` to `1` inclusive to change it. Smaller values produce
more triangles. Rerun modeling operations to rebuild the model at the new setting;
existing memoized nodes retain their caches. Closed curves keep at least four
segments even at coarse settings, so profile polylines remain nondegenerate. Triangulation samples shared boundaries
together and uses Earcut for planar caps.
Collinear boundary vertices are preserved to prevent cracks. Only the final
triangle output uses `Float32Array`; analytic coordinate evaluation uses JavaScript
numbers. Changing mesh density never changes the stored mathematical geometry.

Adaptive midpoint probes can miss oscillations between probes; they do not
provide a certified global error bound for arbitrary evaluators. General spatial
surfaces support curvature in both parameters and periodic seams. Solid booleans
retain arbitrary UV regions through `SurfaceRegion`; the standalone `trimSurface`
tool currently keeps its simpler cutting-plane chart restrictions. Sketch booleans
and constraints remain outside the current API. Invalid trim intersections or triangulations fail
explicitly rather than producing partial meshes.

## Default objects

Shared defaults live in `src/defaults/` and are exported from the root:

| Default | Value or local frame | Normal |
| --- | --- | --- |
| `center` | Local XY point `{ x: 0, y: 0 }` | — |
| `origin` | World-space vec3 `[0, 0, 0]` | — |
| `X` | Zero-origin unit spatial line `[1, 0, 0]` | — |
| `Y` | Zero-origin unit spatial line `[0, 1, 0]` | — |
| `Z` | Zero-origin unit spatial line `[0, 0, 1]` | — |
| `negX` | Zero-origin unit spatial line `[-1, 0, 0]` | — |
| `negY` | Zero-origin unit spatial line `[0, -1, 0]` | — |
| `negZ` | Zero-origin unit spatial line `[0, 0, -1]` | — |
| `XY` | Plane at the world origin, local axes +X / +Y | +Z |
| `ZX` | Plane at the world origin, local axes +Z / +X | +Y |
| `YZ` | Plane at the world origin, local axes +Y / +Z | +X |

These are ready-to-use values. `X`, `Y`, `Z`, `negX`, `negY`, and `negZ` are unit
`SpatialLine` instances with origin `[0, 0, 0]`, compatible with gl-matrix vec3
inputs and extrusion axes.
Treat the shared lines, their origins, and the default planes as immutable.

```ts
import { XY, Z, circle, sketch, extrude } from 'libcompass';

const s = sketch({ plane: XY }).add(circle({ radius: 2 }));
const body = extrude({ sketch: s, axis: Z, length: 1 }); // Extrude one unit along +Z.
```

`circle({ radius: 2 })` and `new Circle({ radius: 2 })` default to local (0, 0).
An explicit `center` is retained by reference; the shared `center` constant is also
a ready-to-use `Point`, for example `circle({ center, radius: 2 })`.
`origin` is a zero vec3, for example `spatialLine({ direction: Z, origin })`.
Treat these shared coordinates as immutable too.

Direct modules are `libcompass/defaults/axes`, `libcompass/defaults/planes`, and
`libcompass/defaults/points`.

## Spatial lines and rigid transformations

`new SpatialLine({ direction, origin })` (or `spatialLine(options)`) is a vec3-compatible
array subclass with a copied `origin` vector, defaulting to zero. The three array
components store the direction without normalization. Both input arrays are copied;
coordinates must be finite and direction nonzero. Array methods such as `slice`
and `map` return ordinary arrays. Extrusion uses the direction and ignores origin.

`rotate({ object, axis, angle })` and `displace({ object, vector })` return new
planes, spatial curves, spatial lines, edges, solids, or surfaces. Rotation uses
signed degrees and the right-hand rule about a `SpatialLine`'s origin and normalized
direction. Displacement uses the supplied vec3 directly, without normalization.

```ts
const axis = spatialLine({ direction: [0, 0, 2], origin: [10, 0, 0] });
const tilted = rotate({ object: XY, axis: X, angle: 30 });
const shiftedAxis = displace({ object: Z, vector: [10, 0, 0] });
const turned = rotate({ object: part, axis, angle: 90 });
const moved = displace({ object: turned, vector: [0, 0, 5] });
```

Every supported class also has nonmutating instance methods, with the same options
except `object`:

```ts
const moved = part.rotate({ axis: Z, angle: 45 }).displace({ vector: [10, 0, 0] });
const tilted = XY.rotate({ axis: X, angle: 30 });
const shiftedAxis = Z.displace({ vector: [10, 0, 0] });
```

Plane, SpatialLine, SpatialCurve, Edge, and Solid implement these methods directly.
Face, SpatialSurface, RuledSurface, TrimmedSurface, and SurfaceRegion inherit them
from Surface. Chaining retains each built-in class and its modeling methods.

Transformations preserve mathematical curve/surface evaluators, source sampling
overrides, shared boundary and vertex identities within the result, plane frames,
trim charts, periodicity, and orientation. Faces remain `Face` objects usable as
sketch planes; ruled, trimmed, and region surfaces retain their built-in kinds.
An origin moves as a point, while a line's direction and a curve's tangent rotate
as vectors. Translation leaves directions unchanged. Solid child geometry moves
under new lazy transform nodes referencing the original children. Inputs, child
lists and memo caches are never modified by the operation. Treat captured source
geometry as immutable, as with other evaluator-based operations.

## Geometry arrays

`displacementArray({ object, vector, N, offset, width })` and
`rotationArray({ object, axis, N, offset, width })` return ordinary JavaScript
arrays of fresh copies. They accept the same geometry as `displace` and `rotate`:
planes, spatial lines/curves, edges, surfaces, and solids. Inputs remain unchanged.
Displacement normalizes `vector` and uses model units for spacing. Rotation uses
a spatial line's origin/direction and signed degrees for spacing.

Specify two of `N`, `offset`, and `width`:

| Given | Computed |
| --- | --- |
| `N`, `offset` | `width = N * offset` |
| `N`, `width` | `offset = width / N` |
| `width`, `offset` | `N = floor(width / offset)` (with integer roundoff tolerance) |

`N` includes a fresh copy at zero. Positions/angles are `0`, `offset`, through
`(N - 1) * offset`; the width endpoint is excluded. Thus width 10 with offset 5
gives two copies, at 0 and 5. A non-divisible width rounds the count down.
Negative spacing reverses the pattern; supplied width and offset must share a
sign. `N` must be positive and integral; spacing and width must be finite and
nonzero. Missing or excessive parameters throw.

For rotation, `N` alone or `offset` alone defaults width to a full circle:
360 degrees, or -360 for a negative offset. `N: 8` produces copies at 0, 45,
through 315 degrees, without repeating the starting copy at 360 degrees.

```ts
const row = displacementArray({ object: part, vector: X, N: 4, offset: 10 });
const grid = displacementArray({ object: row, vector: Y, N: 3, offset: 10 });
scene.add(grid);

const ring = rotationArray({ object: part, axis: Z, N: 8 });
scene.add(ring);
```

Nested array targets are transformed recursively and flattened into one output
array. `grid` above is a `Solid[]` containing twelve solids, ordered by repetition
and then by depth-first target order. For a target with M geometry leaves, N
repetitions return N * M items. Empty arrays contribute no items; readonly input
arrays are accepted. `SpatialLine` stays intact as geometry rather than flattening
into its numeric coordinates. Geometry types,
exact evaluators, shared topology inside each solid, and sampling overrides are
retained by the existing transformations.

## Measurements

`measure({ object })` returns a measurement object and logs that same object
automatically. It accepts sketches, finite points/vertices, planar and spatial
curves, line segments/edges, surfaces, and solids. Infinite geometry (including
planes and spatial lines), arbitrary nodes and annotated wrappers are rejected.

```ts
const dimensions = measure({ object: part });
const perimeter = measure({ object: rectangle({ center, corner2: { x: 5, y: 3 } }) });
const area = measure({ object: part.surfaces });
const combined = measure({ object: [part, part.displace({ vector: [20, 0, 0] })] });
```

Every result has `boundingBox: { min, max, size }`, with three-element XYZ
arrays. Curves and segments additionally return `length`, surfaces return
`surfaceArea`, and solids return `volume`; sketches and points return bounds
only. Standalone planar geometry is measured in XY at Z = 0. Sketch bounds use
the sketch's placement plane, include finite construction points, and ignore
infinite construction lines. Units are model units, square units and cubic units.

Nonempty arrays must share the same measurement type. Their bounds are combined
and their lengths, areas or volumes summed independently; repeated entries and
overlapping geometry are counted separately. Empty geometry has null bounds and
zero area/volume; empty arrays are rejected. A solid is measured from its own
surfaces, excluding child nodes. No input geometry or memo caches are changed.

Curve sampling respects `.sample()` overrides, and surfaces are tessellated at
the current `TRIANGULATION_RESOLUTION`. Curved bounds, lengths, areas and volumes
are approximate at that resolution, with the usual limitations for oscillations
hidden between samples. Volume assumes closed, consistently oriented solids.
An optional `log: result => ...` callback lets hosts route the automatic output
to their console; by default it calls `console.log` once.

## Scene graph and utilities

`Node` groups child nodes, and `Solid` extends `Memo`, which extends `Node`.
`Memo` caches until `refresh()`;
geometry-producing node subclasses override `triangulateUncached()`. `Transform`
exposes XYZ `position`, `rotation` (degrees, XYZ Euler order), and `scale` objects.
Sketches, planes, vertices, edges, curves, and surfaces remain independent math objects.

`AnnotatedNode` extends `Memo` with mutable `name`, `color`, and `alpha` display
properties. Omitted names become `mesh1`, `mesh2`, ... using a hidden built-in
counter. Only successful unnamed constructions increment it; explicit names do
not. The counter persists for the loaded library instance. Color defaults to
`'default'`, preserving the original gold (`#d2a568`), and alpha defaults to `1`.
Alpha ranges from `0` (invisible) to `1` (opaque). Use the constructor or
`annotatedNode(options)` for a general group, or wrap a solid with
`annotate({ solid, name?, color?, alpha? })` / `solid.annotate(options)`.
The wrapper retains the original solid without changing its geometry, topology,
children, or cached mesh. Annotation edits alone do not invalidate geometry.

```ts
scene.add(body.annotate({ name: 'Housing', color: '#5599dd', alpha: 0.6 }));
const assembly = annotatedNode({ name: 'Assembly', color: colors.amber }).add(body, extension);
scene.add(assembly);
```

`colors` is an immutable palette of 16 theme colors: `default`, `red`, `orange`,
`amber`, `yellow`, `lime`, `green`, `teal`, `cyan`, `blue`, `indigo`, `violet`,
`purple`, `pink`, `rose`, and `gray`. Pass a name (`color: 'blue'`), its constant
(`color: colors.blue`), or a custom `#RGB` / `#RRGGBB` string. Names resolve to
hex strings, which are returned by `node.color`. Other CSS names/functions,
numeric colors, and hex strings containing alpha are rejected, including when
assigning `node.color`. Use the separate `alpha` property for opacity.
`AnnotationColor` is the exported option/assignment type.

The compassts viewer renders each nonempty annotated subtree as a separate named
Three.js mesh with its own color and opacity. Nested annotations control their
own subtrees; their geometry is excluded from ancestor meshes. Unannotated
descendants share the nearest annotation, while other geometry keeps the default
material. Each repeated child occurrence retains its own placement. Full scene
triangulation and STL export still include all geometry, even at alpha zero,
without changing coordinates or duplicating triangles for nested annotations.

Use `node.add(first, second)` to append children and `node.remove(first, second)`
to remove child objects by identity. Both methods return the node for chaining.
`add` also accepts arrays mixed with individual nodes, such as
`scene.add(parts, anotherPart, moreParts)`. Readonly arrays are accepted and flattened
one level, preserving order and repeated references. Input arrays are not changed.
Pass large arrays directly to avoid function argument limits; no internal spreading
is used to append them.
Removal deletes all occurrences of the supplied objects and ignores absent ones.
After changing children or transform properties, explicitly refresh affected
memoized nodes and cached ancestors before triangulating again. Refresh only
invalidates the receiving node's cache; it does not recompute geometry or refresh
ancestors or descendants.

```ts
transform.add(extension);
transform.refresh();
const updatedPositions = scene.triangulate();

scene.remove(transform).add(body, extension);
```

`transformMat4(points, matrix, start = 0, n = remainingPoints)` transforms XYZ
triplets in place and returns the same array. `functionalize(name)` produces
`(object, ...args) => object[name](...args)`, including for `Solid.triangulate()`.
Both utilities are available from the root or individual `libcompass/util/…` paths.
