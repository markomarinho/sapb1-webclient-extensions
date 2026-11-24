import { buildApp } from './app.js';

async function start(): Promise<void> {
  const { app, config } = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(
    `[SAP B1 PT Bank Reconciliation API] Listening on http://${config.HOST}:${config.PORT} (mode: ${config.B1_MODE})`
  );
}

start().catch((err) => {
  console.error('Failed to start SAP B1 Bank Reconciliation backend:', err);
  process.exit(1);
});
