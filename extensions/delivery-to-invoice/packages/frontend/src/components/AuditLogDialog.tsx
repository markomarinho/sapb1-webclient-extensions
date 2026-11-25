import React, { useEffect, useState } from 'react';
import type { AuditLogRecord } from '@b1-d2i/shared';
import { Bar, Button, Dialog, Text } from '@ui5/webcomponents-react';
import { api } from '../api';
import { useI18n } from '../i18n';

interface AuditLogDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AuditLogDialog({ open, onClose }: AuditLogDialogProps) {
  const { t, locale } = useI18n();
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
      headerText={t.auditDialogTitle}
      onClose={onClose}
      footer={
        <Bar
          endContent={
            <Button design="Emphasized" onClick={onClose}>
              {t.closeBtn}
            </Button>
          }
        />
      }
    >
      <div style={{ width: '740px', maxWidth: '88vw' }}>
        {logs.length === 0 ? (
          <Text>{t.noAuditLogs}</Text>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #d9d9d9', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem' }}>{t.colDateTime}</th>
                <th style={{ padding: '0.5rem' }}>{t.colUser}</th>
                <th style={{ padding: '0.5rem' }}>{t.colAction}</th>
                <th style={{ padding: '0.5rem' }}>{t.colDetails}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #efefef' }}>
                  <td style={{ padding: '0.45rem', whiteSpace: 'nowrap' }}>
                    {new Date(log.timestamp).toLocaleString(locale)}
                  </td>
                  <td style={{ padding: '0.45rem' }}>{log.actor}</td>
                  <td style={{ padding: '0.45rem', fontWeight: 600 }}>{log.action}</td>
                  <td style={{ padding: '0.45rem' }}>{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}
