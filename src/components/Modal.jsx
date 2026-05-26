import React, { useEffect, useRef } from 'react';

/**
 * Generic Modal component for consistent modal behavior and styling.
 * Handles escape key to close and initial focus management.
 *
 * @param {object} props - Component props.
 * @param {boolean} props.isOpen - Whether the modal is open.
 * @param {function} props.onClose - Function to call when the modal should close.
 * @param {string} props.title - The title of the modal.
 * @param {React.ReactNode} props.children - The content of the modal.
 * @param {string} [props.maxWidth='800px'] - The maximum width of the modal.
 * @param {React.RefObject} [props.initialFocusRef=null] - Optional ref to an element to focus when the modal opens.
 */
export default function Modal({ isOpen, onClose, title, children, maxWidth = '800px', initialFocusRef = null }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Focus the modal or a specific element within it when it opens
    if (initialFocusRef && initialFocusRef.current) {
      initialFocusRef.current.focus();
    } else if (modalRef.current) {
      modalRef.current.focus();
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, initialFocusRef]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="response-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={e => e.stopPropagation()} ref={modalRef} tabIndex={-1} style={{ maxWidth }}>
        <div className="modal-header"><h2 id="modal-title">{title}</h2><button className="close-button" onClick={onClose}>&times;</button></div>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}