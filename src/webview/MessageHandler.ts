import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../shared/types';
import { useGraphStore } from './store/graphStore';

declare function acquireVsCodeApi(): {
  postMessage: (msg: WebviewToExtensionMessage) => void;
};

// VS Code API is a singleton
const vscode = acquireVsCodeApi();

export function postMessage(msg: WebviewToExtensionMessage) {
  vscode.postMessage(msg);
}

export function initMessageHandler() {
  window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
    const msg = event.data;
    const store = useGraphStore.getState();

    switch (msg.type) {
      case 'GRAPH_UPDATE':
        store.setSnapshot(msg.payload);
        break;
      case 'REFERENCES_RESULT':
        store.setReferences(msg.payload.nodeId, msg.payload.locations);
        break;
      case 'PROGRESS':
        store.setProgress(msg.payload);
        break;
      case 'ERROR':
        console.error('[CodeGraph]', msg.payload.message);
        break;
      case 'ACTIVE_FILE_CHANGED':
        store.setActiveFocusLabel(msg.payload.label);
        break;
    }
  });
}
