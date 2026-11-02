import { describe, expect, it } from 'vitest';
import { OFFICIAL_MATERIAL_LIBRARY, resolveMaterialUValue } from './materialLibrary';

describe('Official Architectural Material Library (ISO 10456 / ISO 10077-1 / ASHRAE)', () => {
  it('contains validated material entries with official standards', () => {
    expect(OFFICIAL_MATERIAL_LIBRARY.length).toBeGreaterThan(15);
    for (const entry of OFFICIAL_MATERIAL_LIBRARY) {
      expect(entry.uValueWm2K).toBeGreaterThan(0);
      expect(entry.uValueWm2K).toBeLessThan(10);
      expect(['ISO 10456', 'ISO 10077-1', 'EN 673', 'ASHRAE 90.1', 'ISO 13370']).toContain(entry.standard);
    }
  });

  it('identifies triple and low-e glazing from typical IFC material and type names', () => {
    const triple = resolveMaterialUValue('Triple glazing argon filled', 'window');
    expect(triple).not.toBeNull();
    expect(triple?.entry.uValueWm2K).toBe(0.7);
    expect(triple?.entry.standard).toBe('EN 673');

    const lowE = resolveMaterialUValue('Double Glazing 4-16-4 Low-E Argon', 'window');
    expect(lowE).not.toBeNull();
    expect(lowE?.entry.uValueWm2K).toBe(1.3);

    const single = resolveMaterialUValue('Single clear float glass', 'window');
    expect(single).not.toBeNull();
    expect(single?.entry.uValueWm2K).toBe(5.8);
  });

  it('identifies insulated wall assemblies and materials according to ISO 10456', () => {
    const brick = resolveMaterialUValue('Cavity brick wall with 100mm mineral wool', 'wall');
    expect(brick).not.toBeNull();
    expect(brick?.entry.uValueWm2K).toBe(0.30);
    expect(brick?.entry.standard).toBe('ISO 10456');

    const aac = resolveMaterialUValue('Autoclaved aerated concrete (Ytong 365mm)', 'wall');
    expect(aac).not.toBeNull();
    expect(aac?.entry.uValueWm2K).toBe(0.28);

    const clt = resolveMaterialUValue('Cross-laminated timber wall (CLT)', 'wall');
    expect(clt).not.toBeNull();
    expect(clt?.entry.uValueWm2K).toBe(0.24);

    const sip = resolveMaterialUValue('SIP sandwich panel wall', 'wall');
    expect(sip).not.toBeNull();
    expect(sip?.entry.uValueWm2K).toBe(0.16);
  });

  it('identifies roof and floor constructions', () => {
    const greenRoof = resolveMaterialUValue('Sedum extensive green roof layer', 'roof');
    expect(greenRoof).not.toBeNull();
    expect(greenRoof?.entry.uValueWm2K).toBe(0.20);

    const groundSlab = resolveMaterialUValue('Ground-bearing concrete slab with under-slab insulation', 'floor');
    expect(groundSlab).not.toBeNull();
    expect(groundSlab?.entry.uValueWm2K).toBe(0.30);
    expect(groundSlab?.entry.standard).toBe('ISO 13370');
  });

  it('identifies entrance doors and glazed patio doors', () => {
    const woodDoor = resolveMaterialUValue('Solid hardwood entrance door', 'door');
    expect(woodDoor).not.toBeNull();
    expect(woodDoor?.entry.uValueWm2K).toBe(1.80);

    const composite = resolveMaterialUValue('Insulated composite security door', 'door');
    expect(composite).not.toBeNull();
    expect(composite?.entry.uValueWm2K).toBe(1.20);
  });

  it('returns null gracefully when no match is found', () => {
    expect(resolveMaterialUValue('', 'wall')).toBeNull();
    expect(resolveMaterialUValue('XYZ123UnknownEntity999', 'wall')).toBeNull();
  });
});
