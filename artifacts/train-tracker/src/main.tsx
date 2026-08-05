import { initTelemetry } from './lib/telemetry';

initTelemetry();

import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';

import { configureApiClient } from './lib/api-client';

configureApiClient();

createRoot(document.getElementById('root')!).render(<App />);
