import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../src/app.js';
import { MockServiceLayerClient } from '../src/b1/serviceLayerClient.js';
import { runInCompany } from '../src/company/context.js';
import { loadConfig } from '../src/config/env.js';

const COMPANIES = JSON.stringify({ 'Empresa A Lda': 'DB_A', 'Empresa B Lda': 'DB_B' });
const SESSIONS: Record<string, string> = {
  sessA: 'Empresa A Lda',
  sessB: 'Empresa B Lda',
  sessX: 'Empresa Desconhecida',
};

/** Mock Service Layer whose "B1SESSION" cookie identifies the logged-in company, like the real one. */
class SessionAwareMock extends MockServiceLayerClient {
  override async getSessionCompanyName(cookieHeader?: string): Promise<string | null> {
    const id = /B1SESSION=([^;]+)/.exec(cookieHeader ?? '')?.[1];
    return (id && SESSIONS[id]) || null;
  }
}

async function build() {
  const configOverrides = { B1_MODE: 'live', B1_COMPANIES: COMPANIES, B1_COMPANY_DB: 'LEGACY_DB' };
  const config = loadConfig(configOverrides);
  return buildApp({
    dbPath: ':memory:',
    configOverrides,
    b1Client: new SessionAwareMock(config),
  });
}

const as = (session: string) => ({ cookie: `B1SESSION=${session}` });

describe('Multi-company: company comes from the caller session only', () => {
  it('rejects requests without a session or from a company that is not configured', async () => {
    const { app } = await build();

    const none = await app.inject({ method: 'GET', url: '/api/settings' });
    assert.equal(none.statusCode, 401);

    const bogus = await app.inject({ method: 'GET', url: '/api/settings', headers: as('nope') });
    assert.equal(bogus.statusCode, 401);

    const unmapped = await app.inject({ method: 'GET', url: '/api/settings', headers: as('sessX') });
    assert.equal(unmapped.statusCode, 403);
    assert.match(unmapped.json().error, /Empresa Desconhecida/);

    // health stays public
    assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
    await app.close();
  });

  it('isolates settings, conversions, idempotency and audit log per company', async () => {
    const { app, db } = await build();

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: as('sessA'),
      payload: { smtpHost: 'smtp.a.example', minDeliveryAgeDays: 7 },
    });
    assert.equal(put.statusCode, 200);

    const settingsB = (await app.inject({ method: 'GET', url: '/api/settings', headers: as('sessB') })).json()
      .settings;
    assert.notEqual(settingsB.smtpHost, 'smtp.a.example');
    assert.equal(settingsB.minDeliveryAgeDays, 0);
    const settingsA = (await app.inject({ method: 'GET', url: '/api/settings', headers: as('sessA') })).json()
      .settings;
    assert.equal(settingsA.smtpHost, 'smtp.a.example');

    const convertA = await app.inject({
      method: 'POST',
      url: '/api/deliveries/convert',
      headers: as('sessA'),
      payload: { deliveryDocEntries: [501], groupingMode: 'PER_DELIVERY', sendEmail: false },
    });
    assert.equal(convertA.statusCode, 200);
    assert.equal(convertA.json().invoicesCreated, 1);

    const convsA = (await app.inject({ method: 'GET', url: '/api/conversions', headers: as('sessA') })).json()
      .conversions;
    const convsB = (await app.inject({ method: 'GET', url: '/api/conversions', headers: as('sessB') })).json()
      .conversions;
    assert.equal(convsA.length, 1);
    assert.equal(convsB.length, 0);

    // Company B cannot see or retry company A's conversion
    const retryB = await app.inject({
      method: 'POST',
      url: `/api/conversions/${convsA[0].id}/retry-email`,
      headers: as('sessB'),
      payload: {},
    });
    assert.equal(retryB.statusCode, 400);

    const auditA = (await app.inject({ method: 'GET', url: '/api/audit-logs', headers: as('sessA') })).json().logs;
    const auditB = (await app.inject({ method: 'GET', url: '/api/audit-logs', headers: as('sessB') })).json().logs;
    assert.ok(auditA.length > 0);
    assert.equal(auditB.length, 0);

    // Same DocEntry in the other company is NOT treated as already processed (composite key)
    assert.equal(runInCompany('DB_A', () => db.isDeliveryProcessed(501)), true);
    assert.equal(runInCompany('DB_B', () => db.isDeliveryProcessed(501)), false);
    assert.equal(runInCompany('DB_B', () => db.getProcessedDeliveryEntries().size), 0);

    await app.close();
  });
});
