async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  state: (aid) => call('GET', `/api/state?astronaut=${aid}`),
  live: (aid, since) => call('GET', `/api/live?aid=${aid}${since == null ? '' : `&since=${since}`}`),
  health: (aid) => call('GET', `/api/health/${aid}`),
  devices: (aid) => call('GET', `/api/devices/${aid}`),
  readings: (aid, device, since) => call('GET', `/api/readings?astronaut=${aid}&device=${device}&since=${since}`),
  checkin: (aid, body) => call('POST', `/api/checkin/${aid}`, body),
  game: (aid, action, body) => call('POST', `/api/game/${aid}/${action}`, body),
  advance: (hours) => call('POST', '/api/clock/advance', { hours }),
  reset: () => call('POST', '/api/demo/reset'),
  pulse: (aid) => call('GET', `/api/pulse${aid ? `?astronaut=${aid}` : ''}`),
  pulseReset: () => call('POST', '/api/pulse/reset'),
  pulsePause: (paused) => call('POST', '/api/pulse/pause', { paused }),
};
