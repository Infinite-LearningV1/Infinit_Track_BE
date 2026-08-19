export function configureProxyTrust(app, env) {
  if (env === 'production') {
    app.set('trust proxy', 'loopback');
  }

  return app;
}
