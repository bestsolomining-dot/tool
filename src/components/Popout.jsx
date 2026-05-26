import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders children in a new browser window using a React Portal.
 */
export default function Popout({ title, onClose, children }) {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    // Open a new browser window
    const win = window.open('', '', 'width=1200,height=900,left=100,top=100,resizable=yes,scrollbars=yes');
    if (!win) {
      alert('Popup blocked! Please allow popups for this site.');
      onClose();
      return;
    }

    win.document.title = title;
    
    // Copy all style and link tags to the new window to maintain styling
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => {
      win.document.head.appendChild(node.cloneNode(true));
    });

    // Apply basic body styling to match the main app theme
    win.document.body.className = 'popup-window-body';
    win.document.body.style.margin = '0';
    win.document.body.style.padding = '24px';
    win.document.body.style.background = '#0f172a'; // App's dark background
    win.document.body.style.color = '#f8fafc';
    win.document.body.style.fontFamily = 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif';

    const div = win.document.createElement('div');
    div.id = 'popout-root';
    win.document.body.appendChild(div);
    setContainer(div);

    // If the user closes the window manually, trigger the onClose handler
    const handleUnload = () => onClose();
    win.addEventListener('beforeunload', handleUnload);

    return () => {
      win.removeEventListener('beforeunload', handleUnload);
      win.close();
    };
  }, [title, onClose]);

  return container ? createPortal(children, container) : null;
}