# BIM DASHBOARD DESIGN CRITIQUE & ANTI-PATTERN AUDIT

> **Directive:** Documented permanently to ensure that the BIM Dashboard and any related simulation / engineering CAD tools never re-introduce these anti-patterns.

---

## 1. Executive Summary & Root Cause Analysis

During review of the preliminary UI generation, several classic "AI Slop" clichés and workstation usability regressions were identified. These stem from standard AI training data biases:
1. Treating a high-precision 3D engineering canvas like a standard CRUD SaaS dashboard.
2. Duplicating actions and navigation tabs indiscriminately across headers, toolbars, and canvases.
3. Leaking backend/engine status strings into user-facing layout bars.
4. Using raw browser form controls (white square checkboxes, unstyled inline text) in a dark workstation CAD environment.
5. Inadequate 3D camera calculation clipping the model geometry outside the screen bounds.

---

## 2. The 7 Specific Issues Documented & Permanent Solutions

### Issue 1: Broken 3D Camera Framing & Geometry Clipping
* **The Flaw:** The default camera framing multiplier was set to `size * 0.9` or `size * 0.95`. In perspective mode with a standard 45° vertical field of view, this placed the camera inside or right up against the bounding box, cutting off the top and roof corners of the architectural twin.
* **Why it's AI Slop:** A generic 3D viewport snippet that lacks spatial bounding math awareness.
* **The Permanent Rule:** Architectural CAD workspaces must always center the bounding sphere and apply a safety clearance factor of **1.55× to 2.0×** (`size * 1.55`) so the building is showcased with breathing room in an isometric 3/4 beauty view.

### Issue 2: Duplicate Ghost Navigation in Header
* **The Flaw:** The top header featured tabs (`Analytics`, `Strategies`, `Scenarios`, `Data`) despite an analytical bottom drawer already existing to host those exact views.
* **Why it's AI Slop:** LLMs copy navbar patterns from e-commerce/blog templates without understanding that workstation software uses a unified workspace drawer.
* **The Permanent Rule:** Exactly **ONE** single point of navigation for analytical sheets. The header is strictly for document identity, model selection (`Sample Office` / `Tower Model`), location metadata, and export actions.

### Issue 3: Duplicate Primary Action Buttons (`Import IFC`)
* **The Flaw:** A prominent `+ Import IFC` button appeared in the top header *and* another `Import IFC` floating button was rendered directly inside the 3D viewport canvas.
* **Why it's AI Slop:** The model indiscriminately attached the primary CTA everywhere it generated a toolbar.
* **The Permanent Rule:** Never duplicate a primary action CTA on the same view. Import IFC lives cleanly in the topbar action cluster.

### Issue 4: Redundant Viewport Toolbars & Toggles
* **The Flaw:** Both a top horizontal floating glass dock and a left vertical 'T' shelf contained toggles for `Orbit`, `Wireframe`, `Grid`, and `Axes`.
* **Why it's AI Slop:** Fragmented UI components created without centralized coordination.
* **The Permanent Rule:** Follow standard 3D CAD hierarchy (Blender/Rhino):
  - View presets (`Top`, `Front`, `Side`, `3D`, `Fit View`) belong in the top viewport dock.
  - Manipulation tools & display modifiers (`Select`, `Turntable`, `Wireframe`, `Grid`, `Axes`) belong exclusively in the Left 'T' Shelf.

### Issue 5: Floating Layer Button Clusters Over 3D Canvas
* **The Flaw:** A floating bottom-right badge container on the 3D viewport contained buttons for `Wall`, `Window`, `Roof`.
* **Why it's AI Slop:** Random overlay pills that occlude the model and duplicate functionality already present in the Scene Outliner tree.
* **The Permanent Rule:** Keep the 3D canvas clean and uncluttered. Visibility toggling belongs strictly in the hierarchical Scene Outliner in the Inspector panel.

### Issue 6: Runtime Debug String Leakage in Header
* **The Flaw:** Displaying `(Sample building loaded)` in the header right next to the document title.
* **Why it's AI Slop:** Exposing backend debug console logs as UI text.
* **The Permanent Rule:** Replace debug logs with a real workstation model switcher: clean segmented pill buttons (`[ Sample Office ] [ Tower Model ]`) allowing one-click testing between different geometry types.

### Issue 7: Unstyled Text Tags & Raw HTML Form Controls
* **The Flaw:**
  - Provenance tags (`GEO`, `STD`, `IFC`) rendered as unstyled plain text directly colliding with property labels.
  - "Enable Natural Ventilation" used a default browser white square checkbox.
* **Why it's AI Slop:** Lack of dedicated CSS design tokens for form controls in dark mode.
* **The Permanent Rule:**
  - Every provenance/data tag must have explicit badge styling with semantic color coding (Green = IFC extracted, Blue = GEO derived, Amber = STD assumption).
  - All toggles must use custom CAD dark switches with status LEDs (`.cad-toggle-btn`).

### Issue 8: Double Footer Sandwich
* **The Flaw:** A collapsible bottom drawer handle sat directly on top of a redundant static `<footer className="footer-banner">`.
* **Why it's AI Slop:** Stacking independent component snippets without a coherent layout shell.
* **The Permanent Rule:** Unify the collapsible drawer handle and the system status telemetry into a single, cohesive bottom status bar.

---

## 3. Checklist for Future Work & Code Reviews
- [x] Is the 3D canvas 100% full-bleed stage?
- [x] Are the colors drawn strictly from the Blender 4 / Rhino charcoal slate palette (`#16171a`, `#22252a`, `#26292f`, `#ea7600`, `#365d8c`)?
- [x] Is there zero button or navigation duplication?
- [x] Are all numbers in the property inspector interactive Blender-style drag scrubbers?
- [x] Is the bottom drawer collapsible and cleanly integrated with status telemetry?
