import React from 'react';
import type { SentEmailPreview } from '@b1-d2i/shared';
import { Bar, Button, Dialog, Label, Text } from '@ui5/webcomponents-react';

interface EmailPreviewDialogProps {
  email: SentEmailPreview | null;
  onClose: () => void;
}

export function EmailPreviewDialog({ email, onClose }: EmailPreviewDialogProps) {
  return (
    <Dialog
      open={Boolean(email)}
      headerText="Pré-visualização do Email Enviado"
      style={{ width: '640px', maxWidth: '95vw' }}
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
      {email && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div>
            <Label>Para: </Label>
            <Text>{email.to}</Text>
          </div>
          {email.cc && (
            <div>
              <Label>CC: </Label>
              <Text>{email.cc}</Text>
            </div>
          )}
          <div>
            <Label>Assunto: </Label>
            <Text style={{ fontWeight: 600 }}>{email.subject}</Text>
          </div>
          <div>
            <Label>Anexo: </Label>
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
