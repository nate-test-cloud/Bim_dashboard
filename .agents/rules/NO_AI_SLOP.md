# PERMANENT ARCHITECTURAL RULE: BLACKLISTED AI-SLOP TEMPLATES

> [!CAUTION]
> **STRICT ARCHITECTURAL DIRECTIVE — ZERO AI SLOP**
> Under NO circumstances should any agent or developer generate stereotypical SaaS dashboard patterns or the blacklisted UI anti-patterns below.

---

## 1. The Blacklisted Clichés & Anti-Patterns
NEVER generate interfaces containing:
1. **The 3-Column SaaS Trap:** Squeezing a 3D WebGL canvas into a small 400px card between sidebars with Recharts stacked underneath.
2. **Duplicate Ghost Navigation:** Never place analytics tabs in the top header if an analytical bottom drawer already exists.
3. **Duplicate Primary Buttons:** Never put multiple identical primary buttons (e.g. `Import IFC`) on the screen at the same time.
4. **Redundant Toolbars:** Never duplicate toggles (Orbit, Wire, Grid, Axes) in both a top horizontal bar and a vertical shelf.
5. **Floating Button Clusters on Canvas:** Never put floating layer filter buttons (`Wall`, `Window`, `Roof`) over the 3D model when a Scene Outliner tree exists.
6. **Debug Text in Header:** Never display engine logs like `(Sample building loaded)` in the header.
7. **Unstyled Inline Tags in Labels:** Never smush unstyled text like `GEO` or `STD` directly into property label strings.
8. **Raw Browser Form Controls:** Never use white HTML checkboxes in a dark CAD theme.
10. **NO EXCESSIVE BLUE / GENERIC BLUE SLOP:** Never flood numeric fields, scrubber fills, cards, active states, lighting, or 3D materials with generic saturated primary blue (`#3b82f6`, `#2563eb`, `#38bdf8`, `#365d8c`). High-end CAD software (Blender/Rhino) uses neutral graphite fills (`rgba(255,255,255,0.08)`), neutral dark charcoal roofs (`#38393d`), smoked architectural glass (`#82919e`), and iconic Blender Active Orange (`#ea7600`) for selection.

---

## 2. Mandatory Standard: Full-Bleed CAD & Studio Workspace
All engineering, BIM, and 3D simulation interfaces in this project MUST follow the layout paradigms of **Blender, Unreal Engine, and Rhino**:
1. **Full-Bleed Viewport Hero (100% Canvas):** Centered isometric 3/4 beauty angle framing the geometry cleanly.
2. **Left 'T' Toolbar Shelf:** Slim 32px vertical strip for manipulation tools.
3. **Unified Right Inspector with Outliner:** Segmented tabs (`⚡ Envelope`, `🌐 Climate`, `📊 Specs`, `🗂 Outliner`).
4. **Blender-Style Scrubber Pills:** Interactive numeric drag scrubbers with embedded magnitude fill.
5. **Single Unified Status Bar & Collapsible Drawer:** Clean drawer tab integrated with telemetry.
6. **Workstation Palette:** Neutral charcoal slate (`#16171a`, `#22252a`, `#26292f`), subtle hairline borders (`#181a1e`), Blender active orange (`#ea7600`), and neutral graphite scrubbers (`rgba(255, 255, 255, 0.08)`).

