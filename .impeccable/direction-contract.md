# JobSync Cloud redesign direction

User-pinned replacement world; code-led build. No approved raster comp.

## Product and mode

Operate in the workspace: make the next useful action obvious to an active job seeker. Persuade on landing and pricing: communicate resume → relevant openings → application progress immediately. Preserve explicit resume consent, factual provenance, billing limits, provider behavior, tenant isolation, and durable workers.

## Visual system

Geist, a soft neutral ground, white or charcoal surfaces, restrained accessible blue, 12px corners, low-contrast 1px borders, and restrained ambient depth. Hierarchy comes from space and type. Primary actions use blue; optional actions use neutral surfaces. The JobSync mark joins a J-shaped hook to an outward arrow.

## Journey

Signup and email verification → simple upload → review and explicit confirmation → one suggested starting role → Discover. Remaining targeting is optional and progressively disclosed. Company choice happens in Discover. Home promotes resume upload before confirmation, discovery before applications exist, and next actions as the search develops. No automatic application or invented opportunity claims.

## Responsive and interaction contract

At phone/tablet widths, Home, Jobs, Discover, and Resume use a bottom dock with safe-area padding and content clearance. Settings and theme remain in the top header. Desktop uses a sidebar. Shared tabs scroll inside their own container; Settings uses compact mobile labels with full accessible names. Base UI owns focus and keyboard semantics. Motion is brief, optional, and respects reduced motion. Forms retain unsaved state through tab/step changes.

## Acceptance

Real-content screenshots at 320, 390, 768, and 1280/1440px; light/dark; keyboard; reduced motion. No page-level horizontal overflow. FAQs use shadcn-style Radix Accordion. Trial and Plus limits come from existing constants. Every service test and production lifecycle proof must pass. The mechanical detector flagged layout animation on the first pass; the indicator now slides with transform rather than animated dimensions.

## Seed provenance

Initial roll key: `cd6257cd`, assigned index 3. The neutral monochrome product challenger was considered within the user-pinned minimal, restrained blue direction. The explicit brief governs FORM; no foreign visual metaphor or raster comp was introduced. This is a code-led redesign.
