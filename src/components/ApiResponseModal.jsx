import React from 'react';
import Modal from './Modal';

export default function ApiResponseModal({ isOpen, onClose, lastCall, content }) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="API Response Details"
            maxWidth="1100px"
        >
            {lastCall && (
                <div className="response-meta" style={{ marginBottom: '15px', opacity: 0.8, fontSize: '12px' }}>
                    <span>{lastCall.method} {lastCall.path} — {lastCall.status} ({lastCall.durationMs}ms)</span>
                </div>
            )}
            <pre className="response-body modal" style={{ maxHeight: '60vh', overflow: 'auto' }}>
                {JSON.stringify(content, null, 2)}
            </pre>
        </Modal>
    );
}