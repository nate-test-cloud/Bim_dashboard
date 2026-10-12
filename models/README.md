# Test BIM models

Sample IFC files for exercising the app's BIM import
(File ▸ Import BIM model, or drag-and-drop into the import dialog).
Just open each file in the app — no conversion needed.

| File | Size | Schema | Contents (as read by this app's parser) | Good for testing |
|---|---|---|---|---|
| `FZK-Haus.ifc` | 4.1 MB | IFC2X3 | Detached house: 13 walls, 11 windows, 5 doors, 4 floors; 30 elements with extracted U-values; 2 storeys, 7 spaces | **Start here** — realistic envelope analysis |
| `Institute-Var-2.ifc` | 2.8 MB | IFC2X3 | Office building: 119 walls, 206 windows, 77 doors, 26 floors; all 428 elements carry U-values; 5 storeys, 82 spaces | Larger model, scenario comparison |
| `Building-Architecture.ifc` | 92 KB | IFC2X3 | 4 walls, 3 floors, 1 roof (no windows); areas extracted, **no U-values** | Assumption fallbacks + missing-data warnings |
| `Revit-Quantities.ifc` | 88 KB | IFC2X3 | 10 walls, 2 windows, 1 door — but its quantities are *space* areas, so element areas read unknown | Missing-quantity path, manual-entry workflow |
| `Wall-Opening-Window.ifc` | 12 KB | IFC4 | 1 wall + 1 window, both with extracted U-values | IFC4 schema smoke test |
| `WallOnly.ifc` | 5 KB | IFC2X3 | Single wall, no quantities | Minimal edge case |
| `EmptyTest.ifc` | 350 B | — | No building elements at all | Graceful rejection: the app must refuse it with a helpful message, not crash |
| `261001_LEEZA_SOHO.ifc` | 810 MB | IFC2X3 (cm) | Real project model (Revit 2026 export): ~46k structural steel parts (mullions/plates), 121 slabs, 6 curtain walls, 41 storeys — **no walls/windows/doors and no quantity sets** | Full-scale test: real-geometry viewer placement, type-level data, assumption fallbacks. Allow several minutes to parse; camera auto-fits on load |

Expected behaviour: every file above either imports with an element summary
(plus honest warnings about anything missing) or — for `EmptyTest.ifc` only —
is rejected with an explanatory error. The 3D viewer always shows the *imported*
elements, never a substitute shape.

## Sources & licence

- `FZK-Haus.ifc`, `Institute-Var-2.ifc`, `Revit-Quantities.ifc`, `WallOnly.ifc`,
  `EmptyTest.ifc` — [opensourceBIM/TestFiles](https://github.com/opensourceBIM/TestFiles)
  (`TestData/data/`, filenames `AC11-FZK-Haus-IFC.ifc`, `AC11-Institute-Var-2-IFC.ifc`,
  `revit_quantities.ifc`, `WallOnly.ifc`, `EmptyTest.ifc`).
- `Building-Architecture.ifc`, `Wall-Opening-Window.ifc` —
  [buildingSMART/Sample-Test-Files](https://github.com/buildingSMART/Sample-Test-Files).

These are community interoperability test files, provided for testing IFC tooling.
Keep them for local testing; check the source repositories before redistributing.
