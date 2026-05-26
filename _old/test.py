

import requests

r = requests.get('https://api.open-meteo.com/v1/forecast', params={
    'latitude': 45.86212, 'longitude': 10.87536,
    'hourly': 'winddirection_10m,wind_direction_10m',
    'forecast_days': 1, 'models': 'meteoswiss_icon_ch1'
})
d = r.json()
print("Variabili:", list(d["hourly"].keys()))
print("Prime 3 direzione:", d["hourly"].get("winddirection_10m", ["N/A"])[:3])
print("Prime 3 wind_direction:", d["hourly"].get("wind_direction_10m", ["N/A"])[:3])