import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@btterm/ui';

const root = document.getElementById('root');
if (root) {
  // window.btterm은 여기서 한 번만 읽어 주입한다(DESIGN §11).
  createRoot(root).render(
    <StrictMode>
      <App api={window.btterm} platform={window.btterm.platform} />
    </StrictMode>,
  );
}
