import { buildApp } from './app.js';

async function start(): Promise<void> {
  const { app, config } = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(
    `[SAP B1 Delivery-to-Invoice API] Listening on http://${config.HOST}:${config.PORT} (B1: ${config.B1_MODE}, Email: ${config.EMAIL_MODE})`
  );
}

start().catch((err) => {
  console.error('Failed to start Delivery-to-Invoice backend:', err);
  process.exit(1);
});
