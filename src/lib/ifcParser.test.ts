import { describe, expect, it } from 'vitest';
import { parseIfcText, validateIfcFile } from './ifcParser';

const MINI_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('mini.ifc','2026-01-01T00:00:00',('A'),('B'),'C','D','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'Doe',$,$,$,$,$);
#10=IFCBUILDINGSTOREY('g1',$,'Ground Floor',$,$,$,$,$,.ELEMENT.);
#20=IFCWALL('wall-guid-1',$,'Wall A',$,$,$,$,$,$);
#21=IFCWALLSTANDARDCASE('wall-guid-2',$,'Wall B',$,$,$,$,$,$);
#22=IFCWINDOW('win-guid-1',$,'Window 1',$,$,$,$,$,$);
#23=IFCSLAB('slab-guid-1',$,'Slab 1',$,$,$,$,$,$);
#30=IFCELEMENTQUANTITY('q1',$,('Qto_WallBaseQuantities'),$,(#31,#32));
#31=IFCQUANTITYLENGTH('Length','',$,10.0);
#32=IFCQUANTITYLENGTH('Height','',$,3.0);
#33=IFCELEMENTQUANTITY('q2',$,('Qto_WallBaseQuantities'),$,(#34));
#34=IFCQUANTITYAREA('NetSideArea','',$,25.0);
#35=IFCELEMENTQUANTITY('q3',$,('Qto_WindowBaseQuantities'),$,(#36));
#36=IFCQUANTITYAREA('Area','',$,6.0);
#37=IFCELEMENTQUANTITY('q4',$,('Qto_SlabBaseQuantities'),$,(#38));
#38=IFCQUANTITYAREA('GrossArea','',$,240.0);
#40=IFCPROPERTYSET('ps1',$,'Pset_WallCommon',$,(#41));
#41=IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(0.32),$);
#42=IFCRELDEFINESBYPROPERTIES('r1',$,$,$,(#20),#40);
#50=IFCRELDEFINESBYPROPERTIES('r2',$,$,$,(#20),#30);
#51=IFCRELDEFINESBYPROPERTIES('r3',$,$,$,(#21),#33);
#52=IFCRELDEFINESBYPROPERTIES('r4',$,$,$,(#22),#35);
#53=IFCRELDEFINESBYPROPERTIES('r5',$,$,$,(#23),#37);
#60=IFCMATERIAL('Concrete');
#61=IFCRELASSOCIATESMATERIAL('m1',$,$,$,(#20),#60);
ENDSEC;
END-ISO-10303-21;
`;

describe('ifcParser', () => {
  it('extracts walls/windows/slabs with quantities and U-values', async () => {
    const m = await parseIfcText(MINI_IFC, 'mini.ifc');
    expect(m.schema).toBe('IFC2X3');
    const wallA = m.elements.find((e) => e.name === 'Wall A')!;
    expect(wallA.category).toBe('wall');
    // Length×Height fallback → 30 m² derived
    expect(wallA.areaM2).toBeCloseTo(30, 6);
    expect(wallA.areaProvenance).toBe('derived');
    // Pset U-value extracted
    expect(wallA.uValueWm2K).toBeCloseTo(0.32, 6);
    expect(wallA.uProvenance).toBe('extracted');
    expect(wallA.material).toBe('Concrete');
    const win = m.elements.find((e) => e.name === 'Window 1')!;
    expect(win.category).toBe('window');
    expect(win.areaM2).toBeCloseTo(6, 6);
    const slab = m.elements.find((e) => e.name === 'Slab 1')!;
    expect(slab.category).toBe('floor');
    expect(m.storeys).toContain('Ground Floor');
  });

  it('rejects rvt with export guidance and non-ifc types', () => {
    const rvt = new File(['x'], 'model.rvt');
    expect(validateIfcFile(rvt)).toMatch(/export.*IFC/i);
    const txt = new File(['x'], 'notes.txt');
    expect(validateIfcFile(txt)).toMatch(/Unsupported/);
    const ok = new File(['x'], 'model.ifc');
    expect(validateIfcFile(ok)).toBeNull();
  });

  it('throws a helpful error when no envelope elements exist', async () => {
    const empty = `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCPROJECT('g',$,'P',$,$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;`;
    await expect(parseIfcText(empty, 'empty.ifc')).rejects.toThrow(/No envelope or structural/);
  });

  it('inherits U-values and materials from the element type', async () => {
    const t = `ISO-10303-21;
HEADER;FILE_SCHEMA(('IFC2X3'));ENDSEC;
DATA;
#1=IFCWALL('w1',$,'Wall T',$,$,$,$,$,$);
#2=IFCWALLTYPE('t1',$,'Type W',$,$,$,$,$,$,.NOTDEFINED.);
#3=IFCRELDEFINESBYTYPE('r',$,$,$,(#1),#2);
#4=IFCPROPERTYSET('p',$,'Pset_WallCommon',$,(#5));
#5=IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(0.28),$);
#6=IFCRELDEFINESBYPROPERTIES('rp',$,$,$,(#2),#4);
#7=IFCMATERIAL('Blockwork');
#8=IFCRELASSOCIATESMATERIAL('rm',$,$,$,(#2),#7);
ENDSEC;
END-ISO-10303-21;`;
    const m = await parseIfcText(t, 'typed.ifc');
    const w = m.elements.find((e) => e.name === 'Wall T')!;
    expect(w.uValueWm2K).toBeCloseTo(0.28, 6);
    expect(w.uProvenance).toBe('extracted');
    expect(w.material).toBe('Blockwork');
  });

  it('resolves extrusion geometry with millimetre units and door overall dims', async () => {
    const t = `ISO-10303-21;
HEADER;FILE_SCHEMA(('IFC2X3'));ENDSEC;
DATA;
#1=IFCPROJECT('p',$,'P',$,$,$,$,$,#2);
#2=IFCUNITASSIGNMENT((#3));
#3=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCAXIS2PLACEMENT3D(#10,$,$);
#12=IFCLOCALPLACEMENT($,#11);
#13=IFCRECTANGLEPROFILEDEF(.AREA.,$,#14,4000.,200.);
#14=IFCAXIS2PLACEMENT2D(#15,$);
#15=IFCCARTESIANPOINT((0.,0.));
#16=IFCDIRECTION((0.,0.,1.));
#17=IFCEXTRUDEDAREASOLID(#13,#11,#16,3000.);
#18=IFCSHAPEREPRESENTATION(#19,'Body','SweptSolid',(#17));
#19=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#20,$,.MODEL_VIEW.,$);
#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#21,$);
#21=IFCAXIS2PLACEMENT3D(#10,$,$);
#22=IFCPRODUCTDEFINITIONSHAPE($,$,(#18));
#30=IFCWALL('wall1',$,'Wall G',$,$,#12,#22,$);
#40=IFCDOOR('door1',$,'Door D',$,$,$,$,'tag',2100.,900.);
#50=IFCMEMBER('mem1',$,'Mullion M',$,$,$,$,'tag');
ENDSEC;
END-ISO-10303-21;`;
    const m = await parseIfcText(t, 'geom.ifc');
    expect(m.warnings.join(' ')).toMatch(/millimetre/);
    const w = m.elements.find((e) => e.name === 'Wall G')!;
    // 4 m × 3 m wall face, 0.2 m thick — units converted from mm,
    // IFC Z-up mapped to viewer Y-up.
    expect(w.dims?.x).toBeCloseTo(4, 6);
    expect(w.dims?.y).toBeCloseTo(3, 6);
    expect(w.dims?.z).toBeCloseTo(0.2, 6);
    expect(w.areaM2).toBeCloseTo(12, 4);
    expect(w.areaProvenance).toBe('derived');
    expect(w.center?.y).toBeCloseTo(1.5, 6);
    expect(w.rotation?.[3]).toBeCloseTo(1, 6); // axis-aligned → identity
    const d = m.elements.find((e) => e.name === 'Door D')!;
    expect(d.areaM2).toBeCloseTo(2.1 * 0.9, 6);
    expect(d.areaProvenance).toBe('extracted');
    const s = m.elements.find((e) => e.name === 'Mullion M')!;
    expect(s?.category).toBe('structure');
  });
});
