import React, { useState, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { LibraryPage } from './pages/LibraryPage';
import { StudyPage } from './pages/StudyPage';
import { PhoneticsLab } from './components/PhoneticsLab';
import { OpenWordAtlas, type WordReading } from './components/phoneticsNavigation';
import { useStudyStore } from './stores/useStudyStore';
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
  const [labOpen, setLabOpen] = useState(false);
  const [reading, setReading] = useState<WordReading>();
  const isRecording = useStudyStore(state => state.isRecording);
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

  function openLab(word?: WordReading) {
    if (isRecording) return;
    document.querySelectorAll('video,audio').forEach(media => (media as HTMLMediaElement).pause());
    setReading(word); setLabOpen(true);
  }
  return <OpenWordAtlas.Provider value={isRecording ? null : openLab}>
    {currentView.type === 'study' ? <StudyPage videoId={currentView.videoId} onBackToLibrary={navigateToLibrary} />
      : currentView.type === 'settings' ? <SettingsPage onBackToLibrary={navigateToLibrary} />
      : <LibraryPage onSelectVideo={navigateToStudy} onNavigateToSettings={navigateToSettings} />}
    {currentView.type !== 'study' && <button disabled={isRecording} className="secondary-button fixed bottom-4 right-4 z-40 shadow-lg" onClick={() => openLab()}>Phonetics Lab</button>}
    {labOpen && <PhoneticsLab reading={reading} onClose={() => setLabOpen(false)} />}
  </OpenWordAtlas.Provider>;
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
};

export default App;
