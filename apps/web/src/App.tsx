import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { LoadingSpinner } from './components';
import { SearchView } from './views/SearchView';
import './App.css';

const DetailView = lazy(() => import('./components/DetailView').then(module => ({ default: module.DetailView })));
const SettingsView = lazy(() => import('./views/SettingsView').then(module => ({ default: module.SettingsView })));
const RelationshipGraphView = lazy(() => import('./views/RelationshipGraphView').then(module => ({ default: module.RelationshipGraphView })));
const LayoutView = lazy(() => import('./views/LayoutView').then(module => ({ default: module.LayoutView })));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner message="Ansicht wird geladen..." />}>
      <Routes>
        <Route path="/" element={<SearchView />} />
        <Route path="/object/:uuid" element={<DetailView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/relationship-graph/:fileName" element={<RelationshipGraphView />} />
        <Route path="/relationship-graph" element={<RelationshipGraphView />} />
        <Route path="/layout/:uuid" element={<LayoutView />} />
      </Routes>
    </Suspense>
  );
}

export default App;
