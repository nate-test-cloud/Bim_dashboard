# BIM DASHBOARD DEVELOPMENT DIRECTIVE & WORKSPACE RULES

## ZERO AI SLOP DIRECTIVE (MANDATORY)

Under NO circumstances should any AI assistant or developer reproduce the stereotypical "AI-generated SaaS dashboard" or the following blacklisted UI anti-patterns:

### PERMANENTLY FORBIDDEN PATTERNS:
1. **NO 3-COLUMN DASHBOARD CARDS:** Never squeeze a 3D CAD/BIM viewport into a center card between two sidebars, with 2D Recharts stacked underneath and 2x2 bubbly KPI cards on the right.
2. **NO DUPLICATE NAVIGATION OR GHOST TABS:** Never put analytics navigation tabs in the top header if an analytical bottom drawer already exists. Exactly ONE single point of navigation for each view or tool.
3. **NO DUPLICATE PRIMARY ACTION BUTTONS:** Never display two identical buttons (e.g. `Import IFC` in top header AND floating on the canvas) on the same screen.
4. **NO REDUNDANT VIEWPORT TOOLBARS:** Never duplicate the same toggle buttons (Orbit, Wireframe, Grid, Axes) across both a top horizontal bar and a vertical tool shelf. Keep view snaps (`Top`, `Front`, `Side`, `3D`) in the header/top-right, and tool modifiers in the left vertical shelf.
5. **NO SCREEN-POLLUTING FLOATING BUTTON CLUSTERS:** Never clutter the 3D viewport canvas with floating layer-toggle buttons (`Wall`, `Window`, `Roof`) when a dedicated Scene Outliner tree exists in the sidebar.
6. **NO RUNTIME DEBUG STRINGS IN UI HEADERS:** Never print engine status messages (e.g. `(Sample building loaded)`) in the top application header next to the document title.
7. **NO UNSTYLED INLINE TEXT STRINGS IN LABELS:** Never smush provenance/data tags (`GEO`, `STD`) directly against property labels without a styled badge or pill container.
8. **NO RAW BROWSER FORM CONTROLS:** Never use default OS white square checkboxes or unstyled HTML range sliders in a dark CAD workspace. Always use custom dark CAD toggle switches and interactive scrubber pills.
9. **NO DOUBLE FOOTER SANDWICH:** Never stack a collapsible drawer handle on top of a redundant static footer banner. Unify the drawer handle and system status strip into a single, clean status bar.
10. **MANDATORY DESIGN STANDARD:** Swiss Architectural & Blender/Rhino CAD Workstation:
   - **Full-Bleed 3D Viewport:** 100% canvas stage with isometric 3/4 beauty framing (entire building centered with breathing room).
   - **Floating Telemetry HUD:** High-density live telemetry floats in a subtle bottom-left HUD chip directly over the canvas.
   - **Unified Right Inspector:** A single 320px high-density property panel with segmented tabs (`Envelope`, `Climate`, `Specs`, `Outliner`).
   - **Collapsible Bottom Drawer:** 2D analytical charts live in a collapsible bottom drawer, toggleable with a clean drawer tab.
   - **Workstation Palette:** Neutral charcoal slate (`#16171a`, `#22252a`, `#26292f`), subtle hairline borders (`#181a1e`), Blender active orange (`#ea7600`), and steel blue scrubbers (`#365d8c`).

