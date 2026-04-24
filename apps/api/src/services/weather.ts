import { DateTime } from 'luxon';

const MONTERREY_LAT = 25.6751;
const MONTERREY_LON = -100.3185;
const MONTERREY_TZ = 'America/Monterrey';

export interface WeatherForecast {
  maxTemp: number;
  maxTempTime: string;
  minTemp: number;
  minTempTime: string;
}

export interface WeatherData {
  temp: number;
  windSpeed: number;
  conditionCode: number;
  isDay: boolean;
  time: string;
  description: string;
  forecast?: WeatherForecast;
}

// https://open-meteo.com/en/docs
const WEATHER_CODES: Record<number, string> = {
  0: 'Cielo despejado',
  1: 'Principalmente despejado',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Niebla',
  48: 'Niebla con escarcha',
  51: 'Llovizna ligera',
  53: 'Llovizna moderada',
  55: 'Llovizna densa',
  61: 'Lluvia ligera',
  63: 'Lluvia moderada',
  65: 'Lluvia fuerte',
  71: 'Nieve ligera',
  73: 'Nieve moderada',
  75: 'Nieve fuerte',
  77: 'Granos de nieve',
  80: 'Chubascos ligeros',
  81: 'Chubascos moderados',
  82: 'Chubascos violentos',
  95: 'Tormenta eléctrica',
  96: 'Tormenta con granizo ligero',
  99: 'Tormenta con granizo fuerte',
};

export async function getMonterreyWeather(): Promise<WeatherData | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${MONTERREY_LAT}&longitude=${MONTERREY_LON}&current_weather=true&hourly=temperature_2m&timezone=${encodeURIComponent(MONTERREY_TZ)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather API error: ${res.statusText}`);
    
    const data = await res.json();
    const current = data.current_weather;
    const hourly = data.hourly;
    
    if (!current) return null;

    let forecast: WeatherForecast | undefined;

    if (hourly && hourly.time && hourly.temperature_2m) {
      const now = DateTime.now().setZone(MONTERREY_TZ);
      const endOfDay = now.endOf('day');

      let minTemp = Infinity;
      let minTempTime = '';
      let maxTemp = -Infinity;
      let maxTempTime = '';

      for (let i = 0; i < hourly.time.length; i++) {
        const time = DateTime.fromISO(hourly.time[i], { zone: MONTERREY_TZ });
        
        // Only consider from "now" until the end of the current day
        if (time >= now && time <= endOfDay) {
          const temp = hourly.temperature_2m[i];
          if (temp > maxTemp) {
            maxTemp = temp;
            maxTempTime = time.toFormat('HH:mm');
          }
          if (temp < minTemp) {
            minTemp = temp;
            minTempTime = time.toFormat('HH:mm');
          }
        }
      }

      if (maxTemp !== -Infinity) {
        forecast = { maxTemp, maxTempTime, minTemp, minTempTime };
      }
    }

    return {
      temp: current.temperature,
      windSpeed: current.windspeed,
      conditionCode: current.weathercode,
      isDay: current.is_day === 1,
      time: current.time,
      description: WEATHER_CODES[current.weathercode] || 'Desconocido',
      forecast,
    };
  } catch (error) {
    console.error('[Weather] Failed to fetch weather:', error);
    return null;
  }
}

export function formatWeatherForPrompt(data: WeatherData | null): string {
  if (!data) return 'Información del clima no disponible actualmente.';
  
  let msg = `Clima actual en Monterrey: ${data.temp}°C, ${data.description}.`;
  
  if (data.forecast) {
    msg += `\nPronóstico para el resto del día: Máxima de ${data.forecast.maxTemp}°C a las ${data.forecast.maxTempTime}, mínima de ${data.forecast.minTemp}°C a las ${data.forecast.minTempTime}.`;
  }
  
  return msg;
}
