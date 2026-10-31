/**
 * Location search & live climatic data service for BIM Sustainability Analytics.
 * Sourced from Open-Meteo API (free, open-access, CORS-enabled, no API key required)
 * with robust offline fallback for global architectural site analysis.
 */

export interface SiteLocation {
  id: string | number;
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
  countryCode?: string;
}

export interface ClimateConditions {
  outdoorTempC: number;
  solarIrradianceWm2: number;
  cloudCoverPct: number;
  windSpeedMs: number;
  relHumidityPct: number;
}

export interface SiteClimateData {
  location: SiteLocation;
  timestamp: string;
  weatherCode?: number;
  weatherLabel: string;
  isDay: boolean;
  current: ClimateConditions;
  daylightPeak: ClimateConditions;
  summerDesign: ClimateConditions;
  winterDesign: ClimateConditions;
  source: 'open-meteo-live' | 'offline-model';
}

export const POPULAR_SITES: SiteLocation[] = [
  { id: 'london', name: 'London', country: 'United Kingdom', admin1: 'England', latitude: 51.5074, longitude: -0.1278, elevation: 25, timezone: 'Europe/London', countryCode: 'GB' },
  { id: 'singapore', name: 'Singapore', country: 'Singapore', latitude: 1.3521, longitude: 103.8198, elevation: 15, timezone: 'Asia/Singapore', countryCode: 'SG' },
  { id: 'dubai', name: 'Dubai', country: 'United Arab Emirates', admin1: 'Dubai', latitude: 25.2048, longitude: 55.2708, elevation: 5, timezone: 'Asia/Dubai', countryCode: 'AE' },
  { id: 'newyork', name: 'New York', country: 'United States', admin1: 'New York', latitude: 40.7128, longitude: -74.0060, elevation: 10, timezone: 'America/New_York', countryCode: 'US' },
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', admin1: 'Tokyo', latitude: 35.6762, longitude: 139.6503, elevation: 40, timezone: 'Asia/Tokyo', countryCode: 'JP' },
  { id: 'mumbai', name: 'Mumbai', country: 'India', admin1: 'Maharashtra', latitude: 19.0760, longitude: 72.8777, elevation: 14, timezone: 'Asia/Kolkata', countryCode: 'IN' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', admin1: 'New South Wales', latitude: -33.8688, longitude: 151.2093, elevation: 19, timezone: 'Australia/Sydney', countryCode: 'AU' },
  { id: 'paris', name: 'Paris', country: 'France', admin1: 'Île-de-France', latitude: 48.8566, longitude: 2.3522, elevation: 35, timezone: 'Europe/Paris', countryCode: 'FR' },
  { id: 'berlin', name: 'Berlin', country: 'Germany', admin1: 'Berlin', latitude: 52.5200, longitude: 13.4050, elevation: 34, timezone: 'Europe/Berlin', countryCode: 'DE' },
  { id: 'riyadh', name: 'Riyadh', country: 'Saudi Arabia', admin1: 'Riyadh', latitude: 24.7136, longitude: 46.6753, elevation: 612, timezone: 'Asia/Riyadh', countryCode: 'SA' },
];

/** WMO weather code descriptions */
export function getWeatherLabel(code?: number): string {
  if (code === undefined || code === null) return 'Typical';
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Overcast';
}

/** Search location by string query */
export async function searchLocations(query: string, signal?: AbortSignal): Promise<SiteLocation[]> {
  const trimmed = query.trim();
  if (!trimmed) return POPULAR_SITES.slice(0, 5);

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=7&language=en&format=json`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        return data.results.map((r: any) => ({
          id: r.id ?? `${r.latitude}_${r.longitude}`,
          name: r.name,
          country: r.country || '',
          admin1: r.admin1,
          latitude: r.latitude,
          longitude: r.longitude,
          elevation: r.elevation,
          timezone: r.timezone,
          countryCode: r.country_code,
        }));
      }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    // Fall back to local search
  }

  // Fallback matching against popular sites
  const qLower = trimmed.toLowerCase();
  const matches = POPULAR_SITES.filter(
    (s) =>
      s.name.toLowerCase().includes(qLower) ||
      s.country.toLowerCase().includes(qLower) ||
      (s.admin1 && s.admin1.toLowerCase().includes(qLower)),
  );
  return matches.length > 0 ? matches : POPULAR_SITES.slice(0, 5);
}

/** Synthesize realistic seasonal and daylight design parameters based on latitude and current values */
function deriveDesignConditions(
  lat: number,
  currentTemp: number,
  currentSolar: number,
  hourlySolars?: number[],
  hourlyTemps?: number[],
): {
  daylightPeak: ClimateConditions;
  summerDesign: ClimateConditions;
  winterDesign: ClimateConditions;
} {
  const absLat = Math.abs(lat);
  
  // Calculate peak solar irradiance today
  let peakSolar = currentSolar;
  if (hourlySolars && hourlySolars.length > 0) {
    const maxHourSolar = Math.max(...hourlySolars);
    if (maxHourSolar > 50) peakSolar = maxHourSolar;
  }
  // If searched at night and peakSolar is still near 0, compute theoretical clear-sky peak based on latitude
  if (peakSolar < 150) {
    // Equator ~950 W/m², 45° lat ~750 W/m², 65° lat ~500 W/m²
    peakSolar = Math.round(Math.max(300, 1000 - absLat * 8));
  }

  const maxTempToday = hourlyTemps && hourlyTemps.length > 0 ? Math.max(...hourlyTemps) : currentTemp;

  // Daylight Peak snapshot
  const daylightPeak: ClimateConditions = {
    outdoorTempC: Math.round(maxTempToday * 10) / 10,
    solarIrradianceWm2: Math.round(peakSolar),
    cloudCoverPct: 20,
    windSpeedMs: 2.5,
    relHumidityPct: 45,
  };

  // Summer Design (extreme cooling condition for site latitude)
  const isTropical = absLat < 23.5;
  const summerTemp = isTropical ? 34 : Math.round(Math.max(26, 38 - absLat * 0.25));
  const summerSolar = Math.round(Math.max(750, 1050 - absLat * 4));
  const summerDesign: ClimateConditions = {
    outdoorTempC: summerTemp,
    solarIrradianceWm2: summerSolar,
    cloudCoverPct: 15,
    windSpeedMs: 2.0,
    relHumidityPct: isTropical ? 80 : 45,
  };

  // Winter Design (extreme heating condition for site latitude)
  const winterTemp = isTropical ? 24 : Math.round(Math.min(10, 18 - absLat * 0.6));
  const winterSolar = Math.round(Math.max(100, 500 - absLat * 6));
  const winterDesign: ClimateConditions = {
    outdoorTempC: winterTemp,
    solarIrradianceWm2: winterSolar,
    cloudCoverPct: 75,
    windSpeedMs: 4.5,
    relHumidityPct: 70,
  };

  return { daylightPeak, summerDesign, winterDesign };
}

/** Fetch live climatic conditions for a given location */
export async function fetchSiteClimateData(location: SiteLocation, signal?: AbortSignal): Promise<SiteClimateData> {
  const now = new Date();
  const timestamp = now.toISOString();

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m,shortwave_radiation,is_day,weather_code&hourly=temperature_2m,shortwave_radiation,relative_humidity_2m,wind_speed_10m&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    
    const res = await fetch(url, { signal });
    if (res.ok) {
      const data = await res.json();
      const cur = data.current || {};
      const hourly = data.hourly || {};

      const outdoorTempC = cur.temperature_2m ?? 20;
      const rawSolar = cur.shortwave_radiation ?? 0;
      const cloudCoverPct = cur.cloud_cover ?? 30;
      const windSpeedMs = cur.wind_speed_10m ?? 2.5;
      const relHumidityPct = cur.relative_humidity_2m ?? 50;
      const isDay = cur.is_day === 1;
      const weatherCode = cur.weather_code;
      const weatherLabel = getWeatherLabel(weatherCode);

      const { daylightPeak, summerDesign, winterDesign } = deriveDesignConditions(
        location.latitude,
        outdoorTempC,
        rawSolar,
        hourly.shortwave_radiation,
        hourly.temperature_2m,
      );

      // If current instantaneous solar is during daylight, use it; else if night, informatively use daylight design solar for thermal load
      const effectiveSolar = isDay && rawSolar > 20 ? rawSolar : daylightPeak.solarIrradianceWm2;

      return {
        location,
        timestamp,
        weatherCode,
        weatherLabel,
        isDay,
        current: {
          outdoorTempC: Math.round(outdoorTempC * 10) / 10,
          solarIrradianceWm2: Math.round(effectiveSolar),
          cloudCoverPct: Math.round(cloudCoverPct),
          windSpeedMs: Math.round(windSpeedMs * 10) / 10,
          relHumidityPct: Math.round(relHumidityPct),
        },
        daylightPeak,
        summerDesign,
        winterDesign,
        source: 'open-meteo-live',
      };
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
  }

  // Offline / fallback model
  const absLat = Math.abs(location.latitude);
  const baseTemp = Math.round((30 - absLat * 0.35) * 10) / 10;
  const baseSolar = Math.round(Math.max(350, 950 - absLat * 8));

  const { daylightPeak, summerDesign, winterDesign } = deriveDesignConditions(location.latitude, baseTemp, baseSolar);

  return {
    location,
    timestamp,
    weatherLabel: 'Estimated Climate Profile',
    isDay: true,
    current: {
      outdoorTempC: baseTemp,
      solarIrradianceWm2: baseSolar,
      cloudCoverPct: 25,
      windSpeedMs: 2.5,
      relHumidityPct: 55,
    },
    daylightPeak,
    summerDesign,
    winterDesign,
    source: 'offline-model',
  };
}

/** Generate illustrative monthly averages for a site to feed the annual load chart */
export function generateMonthlySeriesForSite(location: SiteLocation, baseTemp: number, baseSolar: number) {
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const lat = location.latitude;
  const isNorthern = lat >= 0;

  return months.map((m, i) => {
    // Seasonal angle: peak in July (month index 6) for North, Jan (0) for South
    const peakIndex = isNorthern ? 6 : 0;
    const diff = Math.min(Math.abs(i - peakIndex), 12 - Math.abs(i - peakIndex));
    const factor = Math.cos((diff / 6) * Math.PI); // 1.0 at peak summer, -1.0 at winter

    const tempDelta = Math.abs(lat) < 23.5 ? factor * 2.5 : factor * (Math.abs(lat) * 0.28);
    const solarFactor = Math.abs(lat) < 23.5 ? 1 + factor * 0.15 : 1 + factor * 0.45;

    return {
      month: `2026-${m} (${monthNames[i]})`,
      tAvgC: +(baseTemp + tempDelta).toFixed(1),
      solarWm2: +Math.max(100, Math.min(1100, baseSolar * solarFactor)).toFixed(0),
    };
  });
}
