import React, { useRef, useState } from 'react';
import type { HouseBankAccount, StatementPreviewResponse } from '@b1-recon/shared';
import {
  Button,
  BusyIndicator,
  Dialog,
  MessageStrip,
  ObjectStatus,
  Option,
  Select,
} from '@ui5/webcomponents-react';
import { api, formatEur } from '../api';

interface Props {
  open: boolean;
  houseBanks: HouseBankAccount[];
  onClose: () => void;
  onImported: (msg: string) => void;
}

export const StatementUploadDialog: React.FC<Props> = ({
  open,
  houseBanks,
  onClose,
  onImported,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StatementPreviewResponse | null>(null);
  const [selectedBankId, setSelectedBankId] = useState<string>('AUTO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSelectedFile(null);
    setPreview(null);
    setSelectedBankId('AUTO');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setSelectedFile(file);
    setError(null);
    setBusy(true);
    try {
      const res = await api.previewStatement(file);
      setPreview(res);
      if (res.matchedHouseBank) {
        setSelectedBankId(res.matchedHouseBank.id);
      }
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedFile) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.importStatement(selectedFile, selectedBankId);
      onImported(
        `Extrato importado: ${res.importedLinesCount} movimentos novos (${res.autoSuggestedCount} com sugestão automática elevada, ${res.skippedDuplicateCount} duplicados ignorados).`
      );
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      headerText="Importar Extrato Bancário (SWIFT MT940 / Norma 43)"
      style={{ width: '640px', maxWidth: '94vw' }}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            padding: '8px 12px',
            width: '100%',
          }}
        >
          <Button design="Transparent" onClick={handleClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            design="Emphasized"
            disabled={!preview || !preview.statement.balanceVerified || preview.newLinesCount === 0 || busy}
            onClick={handleConfirmImport}
          >
            Importar {preview ? `(${preview.newLinesCount} movimentos)` : ''}
          </Button>
        </div>
      }
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            void handleFilePicked(f);
          }}
          style={{
            border: '2px dashed #0070f2',
            borderRadius: '8px',
            padding: '24px',
            textAlign: 'center',
            background: '#f8fbff',
            cursor: 'pointer',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".mt940,.sta,.940,.n43,.c43,.aeb,.txt"
            style={{ display: 'none' }}
            onChange={(e) => void handleFilePicked(e.target.files?.[0])}
          />
          <div style={{ fontWeight: 600, color: '#0070f2', marginBottom: '6px' }}>
            {selectedFile ? selectedFile.name : 'Arraste o ficheiro aqui ou clique para selecionar'}
          </div>
          <div style={{ fontSize: '13px', color: '#556b82' }}>
            Suporta os formatos standard SWIFT MT940 (.mt940, .sta, .940) e Norma 43 / AEB Cuaderno 43 (.n43, .c43, .aeb, .txt)
          </div>
        </div>

        {busy && (
          <div style={{ textAlign: 'center', padding: '12px' }}>
            <BusyIndicator active size="M" />
          </div>
        )}

        {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}

        {preview && (
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #d9d9d9',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#556b82' }}>Formato Detetado</div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>
                  {preview.detectedFormat === 'MT940'
                    ? 'SWIFT MT940'
                    : 'Norma 43 (AEB Cuaderno 43)'}
                </div>
              </div>
              <ObjectStatus
                state={preview.statement.balanceVerified ? 'Positive' : 'Negative'}
                showDefaultIcon
              >
                {preview.statement.balanceVerified
                  ? 'Saldo Matemático Verificado'
                  : `Diferença de Saldo: ${formatEur(preview.statement.balanceDiscrepancy)}`}
              </ObjectStatus>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '10px',
                background: '#f5f6f7',
                padding: '10px 12px',
                borderRadius: '6px',
                fontSize: '13px',
              }}
            >
              <div>
                <div style={{ color: '#556b82', fontSize: '11px' }}>Saldo Inicial</div>
                <strong>{formatEur(preview.statement.openingBalance)}</strong>
              </div>
              <div>
                <div style={{ color: '#556b82', fontSize: '11px' }}>Total Entradas (+)</div>
                <strong style={{ color: '#188918' }}>{formatEur(preview.statement.totalCredits)}</strong>
              </div>
              <div>
                <div style={{ color: '#556b82', fontSize: '11px' }}>Total Saídas (-)</div>
                <strong style={{ color: '#aa0808' }}>{formatEur(preview.statement.totalDebits)}</strong>
              </div>
              <div>
                <div style={{ color: '#556b82', fontSize: '11px' }}>Saldo Final</div>
                <strong>{formatEur(preview.statement.closingBalance)}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '13px' }}>
                <strong>{preview.newLinesCount}</strong> movimentos novos •{' '}
                <span style={{ color: '#556b82' }}>
                  {preview.duplicateLinesCount} já importados anteriormente (idempotência)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#556b82' }}>Conta SAP B1:</span>
                <Select
                  onChange={(e) => {
                    const val = e.detail.selectedOption?.getAttribute('data-id');
                    if (val) setSelectedBankId(val);
                  }}
                >
                  {houseBanks.map((hb) => (
                    <Option
                      key={hb.id}
                      data-id={hb.id}
                      selected={selectedBankId === hb.id}
                    >
                      {hb.bankCode} — {hb.glAccountCode} ({hb.accountLabel})
                    </Option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};
