import { StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import { StartupError } from '@/components/startup-error';
import { StartupLoading } from '@/components/startup-loading';
import { TooltipProvider } from '@/components/ui/tooltip';
import { loadProductionPinnedFontPolicy } from '@/lib/production-pinned-font-policy';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');
void startApplication(createRoot(container));

async function startApplication(root: Root): Promise<void> {
  renderRoot(root, <StartupLoading />);
  try {
    const pinnedFontPolicy = await loadProductionPinnedFontPolicy();
    renderRoot(root, <App pinnedFontPolicy={pinnedFontPolicy} />);
  } catch (error) {
    renderRoot(root, <StartupError error={error} />);
  }
}

function renderRoot(root: Root, child: ReactNode): void {
  root.render(
    <StrictMode>
      <TooltipProvider>{child}</TooltipProvider>
    </StrictMode>,
  );
}
