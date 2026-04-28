import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { useFeatures, FeaturesContext } from './hooks/useFeatures';
import './index.css';

function Root() {
  const featuresState = useFeatures();

  return (
    <FeaturesContext.Provider value={featuresState}>
      <App />
    </FeaturesContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>,
);
