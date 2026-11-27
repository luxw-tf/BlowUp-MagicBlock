import { isMood, isWeather, MOODS, WEATHERS, type MapSelection, type Mood, type Weather } from '../game/arena';

const moodLabels: Record<Mood, string> = { morning: 'Morning', noon: 'Afternoon', sunset: 'Sunset', night: 'Night' };

export function MapSelect({ value, onWeather, onMood, disabled = false }: {
  value: MapSelection;
  onWeather: (weather: Weather | undefined) => void;
  onMood: (mood: Mood | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="map-select" disabled={disabled}>
      <legend>Map selection</legend>
      <label>
        <span>Time of day</span>
        <select value={value.mood ?? ''} onChange={(event) => {
          const choice = event.currentTarget.value;
          onMood(isMood(choice) ? choice : undefined);
        }}>
          <option value="">Random</option>
          {MOODS.map((mood) => <option key={mood} value={mood}>{moodLabels[mood]}</option>)}
        </select>
      </label>
      <label>
        <span>Weather</span>
        <select value={value.weather ?? ''} onChange={(event) => {
          const choice = event.currentTarget.value;
          onWeather(isWeather(choice) ? choice : undefined);
        }}>
          <option value="">Random</option>
          {WEATHERS.map((weather) => (
            <option key={weather} value={weather}>{weather[0].toUpperCase() + weather.slice(1)}</option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
