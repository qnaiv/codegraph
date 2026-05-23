import React from 'react';
import { createRoot } from 'react-dom/client';
import { CodeGraphCanvas } from './components/canvas/CodeGraphCanvas';
import { initMessageHandler, postMessage } from './MessageHandler';

initMessageHandler();

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <React.StrictMode>
    <CodeGraphCanvas />
  </React.StrictMode>
);

// Notify extension that webview is ready
postMessage({ type: 'READY' });
