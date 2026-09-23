/**
 * File Description: Browser entry for Aideos Studio: installs the owner-key header and mounts the app.
 */

import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installOwnerHeader } from './state/agentLink'

// Every studio API call carries this browser's owner key once it has paired an agent.
installOwnerHeader()

createRoot(document.getElementById('root')!).render(
  <App />
)
