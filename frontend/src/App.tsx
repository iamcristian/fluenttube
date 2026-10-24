import React, { useState, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { LibraryPage } from './pages/LibraryPage';
import { StudyPage } from './pages/StudyPage';
import { SettingsPage } from './pages/SettingsPage';

type ViewState =
  | { type: 'library' }
  | { type: 'study'; videoId: number }
  | { type: 'settings' };

function parseHashRoute(): ViewState {
  const hash = window.location.hash;
  if (hash === '#/settings') {
    return { type: 'settings' };
  }
  const match = hash.match(/^#\/study\/(\d+)$/);
  if (match) {
    const videoId = parseInt(match[1], 10);
    if (!isNaN(videoId)) {
      return { type: 'study', videoId };
    }
  }
  return { type: 'library' };
}

export const AppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>(parseHashRoute);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentView(parseHashRoute());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateToStudy = (videoId: number) => {
    window.location.hash = `#/study/${videoId}`;
    setCurrentView({ type: 'study', videoId });
  };

  const navigateToLibrary = () => {
    window.location.hash = '#/';
    setCurrentView({ type: 'library' });
  };

  const navigateToSettings = () => {
    window.location.hash = '#/settings';
    setCurrentView({ type: 'settings' });
  };

  if (currentView.type === 'study') {
    return <StudyPage videoId={currentView.videoId} onBackToLibrary={navigateToLibrary} />;
  }

  if (currentView.type === 'settings') {
    return <SettingsPage onBackToLibrary={navigateToLibrary} />;
  }

  return <LibraryPage onSelectVideo={navigateToStudy} onNavigateToSettings={navigateToSettings} />;
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
};

export default App;
