import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import { createApplication } from './app/create-application';
import { App } from './ui/app';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing.');

const application = createApplication(import.meta.env);
void application.auth?.start();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App application={application} />
  </React.StrictMode>,
);
import.meta.hot?.dispose(() => application.dispose());
