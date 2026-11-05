# Step 3 design record

## Direction and scope

Data terminal, seed **1922461817**, Public Sans loaded locally from npm. The initial Achromatic ledger draw (234895696) was light and contradicted the requested dark theme, so the direction was redrawn once. The source is the user-invoked design-taste-frontend app-screen workflow.

Question: which reference interval, samples and variants am I inspecting, and has its graph loaded?

The reference coordinate interval becomes the workbench's organizing device: search, ruler, cursor, HUD and draggable overview share the same region state. The primary action is coordinate navigation. No graph rendering is implemented in Step 3.

Inventory: GFA 1.1 demo graph; GRCh38 reference; 5901 bp; 62 graph nodes; 66 graph links; Control and Case groups; six sample paths; SNP bubble; 500 bp insertion; deletion link; oriented inversion links; 0-based half-open coordinates. Every numerical UI value is fetched or calculated from API data, never invented. Counts for local display preferences are separate from raw returned graph counts.

Brand constraints override the drawn defaults in three places: the requested #0B0F17 navy-black ground, cyan/amber sample identity swatches, and grid background. The existing project brief also requests glass floating panels; only the floating statistics HUD uses blur. There are no decorative gradients, photos or generated imagery. The grid SVG and Lucide icons are code assets. The main grid's deliberately open region is the requested placeholder, not missing content.

## First browser round

Viewed all fold and page images at 1440, 768 and 390 px. Public Sans was loaded correctly, graph counts matched the live API, minimap proportions matched the actual interval, and no horizontal mobile overflow occurred.

Top issues and fixes:
1. Many control labels were 11–12 px: promote primary control labels to 13 px and HUD/status labels to 12 px.
2. Remove the page-level `data-ui` attribute; it is reserved for cropped interface fragments.
3. Scope the invalid-range test to its explicit error element because Next.js also creates a live alert announcer.

App-specific rationale: sparse center is intentional for Step 3's grid placeholder; six colored identity swatches are sample identifiers, not six graph series. Em dashes represent genuinely missing values, while ranges use coordinate separators. All colors remain tied to sample identity, selection or API status.

## Final critique

ROUND 2

Seen in one second: a dark genomic coordinate workspace with grouped samples and a connected local graph.

Idea (one sentence): the same reference interval organizes the search, coordinate ruler, live cursor, graph HUD and overview window.

Live thing: searching, zooming or dragging the reference interval performs real subgraph requests; sample and variant preferences update the local display-selection counts.

Layout words by section: header=product and connection / toolbar=coordinate navigation / sidebar=sample groups and variant preferences / viewport=grid and live API HUD / minimap=proportional reference interval.

Scores: design 7.8 · usability 8.2 · creativity 7.4 · content 8.4 → overall 7.9 (self-assessment).

Caps applied: none of the page-only imagery and motion caps apply to this app screen. The grid placeholder is explicitly requested for Step 3.

Final checks: production build, ESLint and TypeScript passed; four real-API browser scenarios passed. Inspector at 1440/768/390 reported **0 FAIL, 2 WARN**, with no allow flags. Opened all six final screenshots. Remaining warnings are retained with reasons: `tiny-text` comes from compact axis/status metadata at 11–12 px while main controls are 13–14 px; `panel-void` is the intentionally open grid reserved for the next rendering module. The HUD's glass and cyan/amber sample identities follow the supplied project brief rather than the drawn style defaults.

Top three items after fixes:
1. The mobile center message sits close to the statistics HUD, but both remain visible without overlap in the final 390 px capture.
2. The sidebar needs vertical scrolling on short desktop windows; it keeps every control accessible instead of truncating the sample list.
3. The viewport's center remains sparse until the separately requested rendering step. No fabricated tube paths were added to fill it.

Data provenance: all numbers and sample/group names come from the Step 1 mock database via Step 2 API. The demo reference selector exposes one GRCh38 reference, not a list of unimplemented chromosomes. There are no stock photos, generated images or invented research findings.
