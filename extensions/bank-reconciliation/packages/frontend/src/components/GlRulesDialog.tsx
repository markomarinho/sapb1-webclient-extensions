import React, { useEffect, useState } from 'react';
import type { GlMatchingRule, MovementDirection } from '@b1-recon/shared';
import {
  Button,
  BusyIndicator,
  Dialog,
  Input,
  Label,
  MessageStrip,
  Option,
  Select,
  Tag,
} from '@ui5/webcomponents-react';
import { api } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export const GlRulesDialog: React.FC<Props> = ({ open, onClose, onUpdated }) => {
  const [rules, setRules] = useState<GlMatchingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [direction, setDirection] = useState<MovementDirection>('DEBIT');
  const [keywordsPattern, setKeywordsPattern] = useState('');
  const [glAccountCode, setGlAccountCode] = useState('');
  const [glAccountName, setGlAccountName] = useState('');

  const loadRules = () => {
    setLoading(true);
    api
      .getGlRules()
      .then((res) => setRules(res.rules))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) {
      setError(null);
      loadRules();
    }
  }, [open]);

  const handleAddRule = async () => {
    if (!name.trim() || !keywordsPattern.trim() || !glAccountCode.trim() || !glAccountName.trim()) {
      setError('Preencha o nome da regra, palavras-chave e conta G/L do SAP B1.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.saveGlRule({
        name: name.trim(),
        direction,
        keywordsPattern: keywordsPattern.trim(),
        glAccountCode: glAccountCode.trim(),
        glAccountName: glAccountName.trim(),
        confidence: 94,
      });
      setName('');
      setKeywordsPattern('');
      setGlAccountCode('');
      setGlAccountName('');
      loadRules();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      await api.deleteGlRule(id);
      loadRules();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      headerText="Regras Automáticas de Contabilização G/L (Comissões, Imposto do Selo, Juros)"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', width: '100%' }}>
          <Button design="Emphasized" onClick={onClose}>
            Fechar
          </Button>
        </div>
      }
    >
      <div style={{ width: '780px', maxWidth: '88vw', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '13px', color: '#556b82' }}>
          Quando a descrição de um movimento bancário contém uma das palavras-chave abaixo, o motor sugere
          automaticamente o lançamento direto na Conta do Razão (SAP B1 <code>DocType = rAccount</code>).
        </div>

        {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}

        {/* Add New Rule Form */}
        <div
          style={{
            background: '#f8f9fa',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '10px',
            alignItems: 'end',
          }}
        >
          <div>
            <Label style={{ display: 'block', marginBottom: '4px' }}>Nome da Regra</Label>
            <Input
              placeholder="Ex: Despesas Swift"
              value={name}
              style={{ width: '100%' }}
              onInput={(e) => setName((e.target as unknown as { value: string }).value)}
            />
          </div>
          <div>
            <Label style={{ display: 'block', marginBottom: '4px' }}>Sentido</Label>
            <Select
              style={{ width: '100%' }}
              onChange={(e) => {
                const dir = e.detail.selectedOption?.getAttribute('data-dir') as MovementDirection | undefined;
                if (dir) setDirection(dir);
              }}
            >
              <Option data-dir="DEBIT" selected={direction === 'DEBIT'}>
                Saída (Débito / Custo)
              </Option>
              <Option data-dir="CREDIT" selected={direction === 'CREDIT'}>
                Entrada (Crédito / Proveito)
              </Option>
            </Select>
          </div>
          <div>
            <Label style={{ display: 'block', marginBottom: '4px' }}>
              Palavras-Chave (sep. vírgula)
            </Label>
            <Input
              placeholder="COMISSAO,SWIFT,PORTES"
              value={keywordsPattern}
              style={{ width: '100%' }}
              onInput={(e) => setKeywordsPattern((e.target as unknown as { value: string }).value)}
            />
          </div>
          <div>
            <Label style={{ display: 'block', marginBottom: '4px' }}>Conta G/L SAP B1</Label>
            <Input
              placeholder="Ex: 622701"
              value={glAccountCode}
              style={{ width: '100%' }}
              onInput={(e) => setGlAccountCode((e.target as unknown as { value: string }).value)}
            />
          </div>
          <div>
            <Label style={{ display: 'block', marginBottom: '4px' }}>Designação Conta G/L</Label>
            <Input
              placeholder="Ex: Serviços Bancários"
              value={glAccountName}
              style={{ width: '100%' }}
              onInput={(e) => setGlAccountName((e.target as unknown as { value: string }).value)}
            />
          </div>
          <div>
            <Button design="Emphasized" onClick={() => void handleAddRule()} disabled={loading}>
              Adicionar Regra
            </Button>
          </div>
        </div>

        {/* Rules List */}
        {loading ? (
          <BusyIndicator active size="M" />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#f5f6f7', textAlign: 'left', borderBottom: '1px solid #d9d9d9' }}>
                <th style={{ padding: '8px' }}>Regra</th>
                <th style={{ padding: '8px' }}>Sentido</th>
                <th style={{ padding: '8px' }}>Palavras-Chave</th>
                <th style={{ padding: '8px' }}>Conta G/L SAP B1</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #efefef' }}>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: '8px' }}>
                    <Tag design={r.direction === 'DEBIT' ? 'Negative' : 'Positive'} hideStateIcon>
                      {r.direction === 'DEBIT' ? 'Débito (-)' : 'Crédito (+)'}
                    </Tag>
                  </td>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11.5px' }}>
                    {r.keywordsPattern}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <strong>{r.glAccountCode}</strong> — {r.glAccountName}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    <Button design="Transparent" onClick={() => void handleDelete(r.id)}>
                      Remover
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
};
