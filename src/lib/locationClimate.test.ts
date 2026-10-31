import { describe, expect, it } from 'vitest';
import {
  fetchSiteClimateData,
  generateMonthlySeriesForSite,
  getWeatherLabel,
  POPULAR_SITES,
  searchLocations,
} from './locationClimate';

describe('locationClimate', () => {
  it('has valid popular sites', () => {
    expect(POPULAR_SITES.length).toBeGreaterThanOrEqual(5);
    for (const site of POPULAR_SITES) {
      expect(site.name).toBeTruthy();
      expect(typeof site.latitude).toBe('number');
      expect(typeof site.longitude).toBe('number');
    }
  });

  it('maps weather codes to human readable labels', () => {
    expect(getWeatherLabel(0)).toBe('Clear sky');
    expect(getWeatherLabel(61)).toBe('Rain');
    expect(getWeatherLabel(71)).toBe('Snow');
    expect(getWeatherLabel(95)).toBe('Thunderstorm');
  });

  it('searches locations matching local popular sites when offline or querying directly', async () => {
    const results = await searchLocations('London');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name.toLowerCase()).toContain('london');
  });

  it('generates seasonal monthly series with correct polarities', () => {
    const london = POPULAR_SITES.find((s) => s.name === 'London')!;
    const series = generateMonthlySeriesForSite(london, 15, 500);
    expect(series).toHaveLength(12);
    // Northern hemisphere summer (July, index 6) should be warmer than winter (Jan, index 0)
    expect(series[6].tAvgC).toBeGreaterThan(series[0].tAvgC);
  });

  it('fetches or derives climate data for a site', async () => {
    const london = POPULAR_SITES.find((s) => s.name === 'London')!;
    const climate = await fetchSiteClimateData(london);
    expect(climate).toBeDefined();
    expect(climate.location.name).toBe('London');
    expect(typeof climate.current.outdoorTempC).toBe('number');
    expect(typeof climate.current.solarIrradianceWm2).toBe('number');
    expect(climate.daylightPeak.solarIrradianceWm2).toBeGreaterThanOrEqual(100);
    expect(climate.summerDesign.outdoorTempC).toBeGreaterThan(climate.winterDesign.outdoorTempC);
  });
});
