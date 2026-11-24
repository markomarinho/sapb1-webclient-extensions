import React, { useEffect, useState } from 'react';
import {
  Button,
  BusyIndicator,
  CheckBox,
  Dialog,
  Input,
  MessageStrip,
  ObjectStatus,
  SegmentedButton,
  SegmentedButtonItem,
} from '@ui5/webcomponents-react';
import {
  api,
  getApiBaseUrl,
  setApiBaseUrl,
  type ConnectionSettingsDto,
  type ConnectionTestResultDto,
} from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const ConnectionSettingsDialog: React.FC<Props> = ({ open, onClose, onSaved }) => {
  const [backendUrl, setBackendUrl] = useState<string>(getApiBaseUrl());
  const [settings, setSettings] = useState<ConnectionSettingsDto>({
    mode: 'mock',
    hanaHost: 'localhost',
    hanaPort: 30015,
    hanaSchema: 'SBO_COMPANY_PT',
    hanaReadonlyUser: 'B1_RECON_RO',
    hanaReadonlyPassword: '',
    hanaEncrypt: true,
    hanaSslValidateCert: false,
    b1ServiceLayerUrl: 'https://localhost:50000/b1s/v1',
    b1CompanyDb: 'SBO_COMPANY_PT',
    b1TechUser: 'manager',
    b1TechPassword: '',
    b1RejectUnauthorizedTls: false,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResultDto | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTestResult(null);
    setBackendUrl(getApiBaseUrl());
    setBusy(true);
    api
      .getConnectionSettings()
      .then((res) =>
        setSettings({
          ...res,
          hanaReadonlyPassword: '',
          b1TechPassword: '',
        })
      )
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [open]);

  const handleSaveAndTest = async (runTestAfterSave: boolean) => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      setApiBaseUrl(backendUrl);
      await api.saveConnectionSettings(settings);
      if (runTestAfterSave) {
        const diag = await api.testConnection();
        setTestResult(diag);
      } else {
        onSaved();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      headerText="Configuração & Diagnóstico de Ligação (SAP HANA + Service Layer)"
      style={{ width: '740px', maxWidth: '95vw' }}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            width: '100%',
          }}
        >
          <Button
            design="Default"
            disabled={busy}
            onClick={() => void handleSaveAndTest(true)}
          >
            Guardar &amp; Testar Ligação
          </Button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button design="Transparent" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button
              design="Emphasized"
              disabled={busy}
              onClick={() => void handleSaveAndTest(false)}
            >
              Guardar &amp; Aplicar
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
        {/* Backend API Endpoint (when SPA runs inside SAP B1 Web Client on different port) */}
        <div
          style={{
            background: '#f8f9fa',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Modo de Operação do Motor</strong>
              <div style={{ fontSize: '11.5px', color: '#556b82' }}>
                As credenciais introduzidas são cifradas em repouso com AES-256-GCM no cofre local.
              </div>
            </div>
            <SegmentedButton
              onSelectionChange={(e) => {
                const m = e.detail.selectedItems?.[0]?.getAttribute('data-mode') as
                  | 'mock'
                  | 'live'
                  | undefined;
                if (m) setSettings((s) => ({ ...s, mode: m }));
              }}
            >
              <SegmentedButtonItem data-mode="mock" selected={settings.mode === 'mock'}>
                Mock (Simulação Local)
              </SegmentedButtonItem>
              <SegmentedButtonItem data-mode="live" selected={settings.mode === 'live'}>
                Live (SAP HANA + Service Layer)
              </SegmentedButtonItem>
            </SegmentedButton>
          </div>

          <div>
            <div style={fieldLabelStyle}>
              URL do Backend Node.js (vazio = mesma origem; preencha ex: <code>http://servidor-b1:4010</code> se o
              SPA correr dentro do Web Client noutro porto)
            </div>
            <Input
              placeholder="Vazio (mesma origem) ou http://<ip-servidor>:4010"
              value={backendUrl}
              style={{ width: '100%' }}
              onInput={(e) => setBackendUrl((e.target as unknown as { value: string }).value)}
            />
          </div>
        </div>

        {busy && (
          <div style={{ textAlign: 'center', padding: '6px' }}>
            <BusyIndicator active size="S" />
          </div>
        )}

        {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}

        {testResult && (
          <div
            style={{
              background: '#f5f6f7',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #d9d9d9',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>1. Leitura Direta SAP HANA (SELECT)</div>
              <ObjectStatus state={testResult.hana.ok ? 'Positive' : 'Negative'} showDefaultIcon>
                {testResult.hana.ok
                  ? `Ligado (${testResult.hana.latencyMs}ms) — Schema ${testResult.hana.schema}`
                  : `Falhou: ${testResult.hana.error}`}
              </ObjectStatus>
              {testResult.hana.ok && (
                <div style={{ fontSize: '12px', color: '#556b82', marginTop: '4px' }}>
                  Contas Bancárias (DSC1): <strong>{testResult.hana.houseBanksCount}</strong> • Documentos em
                  Aberto: <strong>{testResult.hana.openDocumentsCount}</strong>
                </div>
              )}
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>2. SAP B1 Service Layer (Escrita)</div>
              <ObjectStatus state={testResult.serviceLayer.ok ? 'Positive' : 'Negative'} showDefaultIcon>
                {testResult.serviceLayer.ok
                  ? `Ligado (${testResult.serviceLayer.latencyMs}ms) — User: ${testResult.serviceLayer.authenticatedUser}`
                  : `Falhou: ${testResult.serviceLayer.error}`}
              </ObjectStatus>
              {testResult.serviceLayer.ok && (
                <div style={{ fontSize: '12px', color: '#556b82', marginTop: '4px' }}>
                  CompanyDB: <strong>{testResult.serviceLayer.companyDb}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SAP HANA Read-Only Section */}
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontWeight: 700, color: '#1d2d3e' }}>
            1. SAP HANA — Leitura Direta Read-Only (<code>@sap/hana-client</code>)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr', gap: '10px' }}>
            <div>
              <div style={fieldLabelStyle}>Servidor SAP HANA (Host / IP)</div>
              <Input
                value={settings.hanaHost}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({ ...s, hanaHost: (e.target as unknown as { value: string }).value }))
                }
              />
            </div>
            <div>
              <div style={fieldLabelStyle}>Porto SQL (ex: 30015)</div>
              <Input
                value={String(settings.hanaPort)}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({
                    ...s,
                    hanaPort: Number((e.target as unknown as { value: string }).value) || 30015,
                  }))
                }
              />
            </div>
            <div>
              <div style={fieldLabelStyle}>Schema da Empresa (SBO_...)</div>
              <Input
                value={settings.hanaSchema}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({ ...s, hanaSchema: (e.target as unknown as { value: string }).value }))
                }
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <div style={fieldLabelStyle}>Utilizador Read-Only (criado pelo script SQL)</div>
              <Input
                value={settings.hanaReadonlyUser}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({
                    ...s,
                    hanaReadonlyUser: (e.target as unknown as { value: string }).value,
                  }))
                }
              />
            </div>
            <div>
              <div style={fieldLabelStyle}>
                Password HANA {settings.hasHanaPassword ? '(Guardada no Cofre — deixe vazio p/ manter)' : ''}
              </div>
              <Input
                type="Password"
                placeholder={settings.hasHanaPassword ? '••••••••' : 'Introduza a password'}
                value={settings.hanaReadonlyPassword ?? ''}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({
                    ...s,
                    hanaReadonlyPassword: (e.target as unknown as { value: string }).value,
                  }))
                }
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckBox
                checked={settings.hanaEncrypt}
                onChange={() => setSettings((s) => ({ ...s, hanaEncrypt: !s.hanaEncrypt }))}
              />
              <span>Ligação HANA TLS (Encrypt)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckBox
                checked={settings.hanaSslValidateCert}
                onChange={() => setSettings((s) => ({ ...s, hanaSslValidateCert: !s.hanaSslValidateCert }))}
              />
              <span>Validar Certificado CA do HANA</span>
            </div>
          </div>
        </div>

        {/* SAP B1 Service Layer Section */}
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontWeight: 700, color: '#1d2d3e' }}>
            2. SAP Business One Service Layer — Sessão &amp; Lançamentos (Pagamentos / Reconciliação)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
            <div>
              <div style={fieldLabelStyle}>URL do Service Layer (ex: https://b1-server:50000/b1s/v1)</div>
              <Input
                value={settings.b1ServiceLayerUrl}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({
                    ...s,
                    b1ServiceLayerUrl: (e.target as unknown as { value: string }).value,
                  }))
                }
              />
            </div>
            <div>
              <div style={fieldLabelStyle}>CompanyDB</div>
              <Input
                value={settings.b1CompanyDb}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({ ...s, b1CompanyDb: (e.target as unknown as { value: string }).value }))
                }
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <div style={fieldLabelStyle}>Utilizador SAP B1 (Fallback quando sem cookie B1SESSION)</div>
              <Input
                value={settings.b1TechUser}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({ ...s, b1TechUser: (e.target as unknown as { value: string }).value }))
                }
              />
            </div>
            <div>
              <div style={fieldLabelStyle}>
                Password SAP B1 {settings.hasB1TechPassword ? '(Guardada no Cofre — deixe vazio p/ manter)' : ''}
              </div>
              <Input
                type="Password"
                placeholder={settings.hasB1TechPassword ? '••••••••' : 'Introduza a password SAP B1'}
                value={settings.b1TechPassword ?? ''}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings((s) => ({
                    ...s,
                    b1TechPassword: (e.target as unknown as { value: string }).value,
                  }))
                }
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckBox
              checked={!settings.b1RejectUnauthorizedTls}
              onChange={() =>
                setSettings((s) => ({ ...s, b1RejectUnauthorizedTls: !s.b1RejectUnauthorizedTls }))
              }
            />
            <span>
              Aceitar certificado TLS auto-assinado do Service Layer on-premise (porta 50000)
            </span>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '11.5px',
  color: '#556b82',
  marginBottom: '4px',
};
