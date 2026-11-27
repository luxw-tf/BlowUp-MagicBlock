import { isWeather, WEATHERS, type Weather } from '../game/arena';

export function WeatherSelect({ value, onChange, disabled = false, label = 'Weather' }: {
  value?: Weather | null;
  onChange: (weather: Weather | undefined) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label className="weather-select">
      <span>{label}</span>
      <select value={value ?? ''} disabled={disabled} onChange={(event) => {
        const choice = event.currentTarget.value;
        onChange(isWeather(choice) ? choice : undefined);
      }}>
        <option value="">Random</option>
        {WEATHERS.map((weather) => (
          <option key={weather} value={weather}>{weather[0].toUpperCase() + weather.slice(1)}</option>
        ))}
      </select>
    </label>
  );
}
