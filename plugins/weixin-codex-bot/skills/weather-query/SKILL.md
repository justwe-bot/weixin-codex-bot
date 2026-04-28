---
name: weather-query
description: Query realtime weather and short-range forecasts for a city or region, then return a concise user-facing summary. Use when the user asks about weather, temperature, rain, wind, air quality, or travel weather planning, including relative dates like today, tomorrow, or this weekend.
---

# Weather Query

When handling a weather request:

1. Identify the target location first.
2. Resolve relative dates like `today`, `tomorrow`, `this weekend`, `今天`, `明天`, `后天` into absolute dates in the user's locale before answering.
3. Call a real weather endpoint with the selected date range and city.
4. If the location is ambiguous, ask one short clarifying question before querying.
5. If the source only supports a limited forecast window, say that clearly instead of fabricating an answer.

Primary endpoint (no API key required):

- Geocode city name:
  - `https://geocoding-api.open-meteo.com/v1/search?name=<CITY>&count=1&language=zh&format=json`
  - Read `results[0].latitude`, `results[0].longitude`, and `results[0].name`.
- Get forecast:
  - `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max&timezone=auto`
  - Use `daily.time` and match the target date index for the requested day.
- Weather code mapping suggestion:
  - `0` 晴朗, `1/2` 晴转多云, `3` 阴, `45/48` 霾/雾, `51-57` 小到中雨, `61-67` 小到大雨, `71-77` 雪, `80-82` 阵雨, `95` 雷雨.

If you need current conditions instead of forecast:

- Call:
  - `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&current_weather=true&timezone=auto`

Response guidance:

- Keep the answer concise and practical.
- Include the location and the exact date in the reply when the user used a relative date.
- For forecasts, include the expected condition, temperature range, and obvious rain or wind risk when available.
- If the user asks a planning-style question such as what to wear or whether to carry an umbrella, add one short suggestion.
- If the weather source is temporarily unavailable, say that directly and suggest retrying or allowing an online lookup.

Do not:

- Answer weather questions from memory.
- Invent precise temperatures, precipitation, or alerts.
- Omit the date when the user asked with a relative expression.
