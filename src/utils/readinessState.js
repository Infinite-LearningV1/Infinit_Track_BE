const initialComponents = {
  database: false,
  scheduler: false
};

function createInitialState() {
  return {
    components: { ...initialComponents }
  };
}

let state = createInitialState();

function setComponentReady(component, ready) {
  if (state.components[component] === ready) {
    return;
  }

  state = {
    ...state,
    components: {
      ...state.components,
      [component]: ready
    }
  };
}

function buildReadinessSnapshot(components) {
  const missing = Object.entries(components)
    .filter(([, ready]) => !ready)
    .map(([component]) => component);
  const ready = missing.length === 0;

  return {
    status: ready ? 'OK' : 'NOT_READY',
    ready,
    timestamp: new Date().toISOString(),
    components: Object.fromEntries(
      Object.entries(components).map(([component, componentReady]) => [
        component,
        componentReady ? 'ready' : 'not_ready'
      ])
    ),
    missing
  };
}

export function markDatabaseReady() {
  setComponentReady('database', true);
}

export function markDatabaseUnready() {
  setComponentReady('database', false);
}

export function markSchedulerReady() {
  setComponentReady('scheduler', true);
}

export function markSchedulerUnready() {
  setComponentReady('scheduler', false);
}

export function getReadinessSnapshot() {
  return buildReadinessSnapshot(state.components);
}

export function resetReadinessState() {
  state = createInitialState();
}
