export function createSyncState(shape = {}) {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    error: null,
    logs: [],
    ...shape,
  };
}

export function pushStateLog(state, message, level = 'info', maxLogs = 300) {
  state.logs.push({ ts: new Date().toISOString(), level, message });
  if (state.logs.length > maxLogs) {
    state.logs.splice(0, state.logs.length - maxLogs);
  }
}
