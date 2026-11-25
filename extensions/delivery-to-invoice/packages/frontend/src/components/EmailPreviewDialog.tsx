import React from 'react';
import type { SentEmailPreview } from '@b1-d2i/shared';
import { Bar, Button, Dialog, Label, Text } from '@ui5/webcomponents-react';
import { useI18n } from '../i18n';

interface EmailPreviewDialogProps {
  email: SentEmailPreview | null;
  onClose: () => void;
}

export function EmailPreviewDialog({ email, onClose }: EmailPreviewDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open={Boolean(email)}
      headerText={t.emailPreviewTitle}
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
      {email && (
        <div style={{ width: '620px', maxWidth: '88vw', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div>
            <Label>{t.toLabel}</Label>
            <Text>
              {email.recipientName ? `${email.recipientName} <${email.to}>` : email.to}
            </Text>
          </div>
          {email.cc && (
            <div>
              <Label>CC: </Label>
              <Text>{email.cc}</Text>
            </div>
          )}
          <div>
            <Label>{t.subjectLabel}</Label>
            <Text style={{ fontWeight: 600 }}>{email.subject}</Text>
          </div>
          <div>
            <Label>{t.attachmentLabel}</Label>
            <Text>
              {email.attachmentFilename} ({(email.attachmentBytes / 1024).toFixed(1)} KB)
            </Text>
          </div>
          <div
            style={{
              marginTop: '0.5rem',
              padding: '1rem',
              border: '1px solid #d9d9d9',
              borderRadius: '6px',
              background: '#fafafa',
            }}
            dangerouslySetInnerHTML={{ __html: email.htmlBody }}
          />
        </div>
      )}
    </Dialog>
  );
}
