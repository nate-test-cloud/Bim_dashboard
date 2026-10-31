# PERMANENT ARCHITECTURAL RULE: BLACKLISTED AI-SLOP TEMPLATES

> [!CAUTION]
> **STRICT ARCHITECTURAL DIRECTIVE — ZERO AI SLOP**
> Under NO circumstances should any agent or developer generate the stereotypical **3-column SaaS dashboard** for this project or any 3D/CAD engineering tool.

---

## 1. The Blacklisted Cliché ("The 3-Column SaaS Trap")
NEVER generate interfaces following this boilerplate:
1. **Left Column:** A stack of generic card accordions with HTML sliders.
2. **Center Column:** Squeezing a 3D WebGL canvas into a small 400px card, followed immediately underneath by two giant Recharts 2D line graphs that push the rest of the app off-screen.
3. **Right Column:** A 2x2 grid of bubbly stat cards with giant bold numbers (`22.4°C`, `58.2 kW`, `50.2 kW`, `145 kWh/m²`).
4. **Card-Soup:** Putting every single piece of information inside a separate rounded rectangle with a 1px border.
5. **Traffic Light Badges:** Using blue, green, and yellow pill badges side-by-side (`● Sample building loaded` in green, `Analytical Engine` in yellow, `Plugins` in blue).

---

## 2. Mandatory Standard: Full-Bleed CAD & Studio Workspace
All engineering, BIM, and 3D simulation interfaces in this project MUST follow the layout paradigms of **Blender, Unreal Engine, Autodesk Forma, and Rhino**:

1. **Full-Bleed Viewport Hero (100% Canvas):**
   * The 3D canvas occupies the entire workspace. The building model is the main event, not a card in a grid.
2. **Floating Viewport HUDs:**
   * Camera controls, azimuth compass, layer toggles, and view tools float directly over the 3D canvas in a minimalist glass dock (`backdrop-filter: blur(12px)`).
3. **Unified Right Inspector:**
   * A single, sleek, high-density property panel on the right (like Figma or Blender properties) with segmented tabs:
     * `[ Envelope & Physics ]`
     * `[ Site & Climate ]`
     * `[ Performance & Specs ]`
4. **Collapsible Bottom Drawer for Analytical Charts:**
   * 2D analytical sweep curves (HVAC load vs Temp, Solar gain) must NEVER sit in the middle of the screen cutting the 3D model in half.
   * They must live in a dockable bottom drawer that can be expanded when needed and collapsed into a compact status bar when viewing the model.
5. **Live Performance Viewport HUD Strip:**
   * High-priority KPIs (Operative Temp, EUI, Peak Demand) float as a discreet, single-line telemetry HUD strip in the bottom-left corner of the 3D viewport.
