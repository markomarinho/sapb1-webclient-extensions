import React, { useEffect, useState } from 'react';
import type { AuditLogRecord } from '@b1-recon/shared';
import { Button, BusyIndicator, Dialog } from '@ui5/webcomponents-react';
import { api } from '../api';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const AuditLogDialog: React.FC<Props> = ({ open, onClose }) => {
  const { t, locale } = useI18n();
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .getAuditLogs()
      .then((res) => setLogs(res.logs))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog
      open={open}
      headerText={t.auditDialogTitle}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', width: '100%' }}>
          <Button design="Emphasized" onClick={onClose}>
            {t.closeBtn}
          </Button>
        </div>
      }
    >
      <div style={{ width: '760px', maxWidth: '88vw', padding: '14px', maxHeight: '460px', overflowY: 'auto' }}>
        {loading ? (
          <BusyIndicator active size="M" />
        ) : logs.length === 0 ? (
          <div style={{ color: '#556b82', fontSize: '13px' }}>{t.noAuditLogs}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f5f6f7', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>{t.colDateTime}</th>
                <th style={{ padding: '8px' }}>{t.colB1User}</th>
                <th style={{ padding: '8px' }}>{t.colAction}</th>
                <th style={{ padding: '8px' }}>{t.colDetails}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #ececec' }}>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                    {new Date(log.createdAt).toLocaleString(locale)}
                  </td>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{log.b1User}</td>
                  <td style={{ padding: '8px' }}>{log.action}</td>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px', color: '#324558' }}>
                    {log.detailsJson}
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
