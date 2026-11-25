import React, { useEffect, useState } from 'react';
import type { AuditLogRecord } from '@b1-d2i/shared';
import { Bar, Button, Dialog, Text } from '@ui5/webcomponents-react';
import { api } from '../api';

interface AuditLogDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AuditLogDialog({ open, onClose }: AuditLogDialogProps) {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);

  useEffect(() => {
    if (!open) return;
    api
      .listAuditLogs()
      .then((res) => setLogs(res.logs))
      .catch(() => setLogs([]));
  }, [open]);

  return (
    <Dialog
      open={open}
      headerText="Registo de Auditoria"
      style={{ width: '760px', maxWidth: '95vw' }}
      onClose={onClose}
      footer={
        <Bar
          endContent={
            <Button design="Emphasized" onClick={onClose}>
              Fechar
            </Button>
          }
        />
      }
    >
      {logs.length === 0 ? (
        <Text>Sem registos de auditoria.</Text>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #d9d9d9', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Data/Hora</th>
              <th style={{ padding: '0.5rem' }}>Utilizador</th>
              <th style={{ padding: '0.5rem' }}>Ação</th>
              <th style={{ padding: '0.5rem' }}>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} style={{ borderBottom: '1px solid #efefef' }}>
                <td style={{ padding: '0.45rem', whiteSpace: 'nowrap' }}>
                  {new Date(log.timestamp).toLocaleString('pt-PT')}
                </td>
                <td style={{ padding: '0.45rem' }}>{log.actor}</td>
                <td style={{ padding: '0.45rem', fontWeight: 600 }}>{log.action}</td>
                <td style={{ padding: '0.45rem' }}>{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
