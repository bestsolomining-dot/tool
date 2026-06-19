import React from "react";
import Modal from "./Modal";
import PoolEditor from "./PoolEditor";

/**
 * A wrapper component that decides whether to render the PoolEditor
 * inside a Modal (Popup) or a separate Window (Popout).
 */
export default function PoolEditorPopup({
  editor,
  onClose,
  onSave,
  onSaveSuccess,
  onVerifySuccess,
  nhClient,
}) {
  const content = (
    <PoolEditor
      pool={editor}
      onClose={onClose}
      onSaveSuccess={onSaveSuccess}
      onSave={onSave}
      onVerifySuccess={onVerifySuccess}
      initialPoolData={editor.initialData}
      isNew={editor.isNew}
      isPopout={false}
      nhClient={nhClient}
    />
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Pool Editor"
      maxWidth="1100px"
    >
      {content}
    </Modal>
  );
}
