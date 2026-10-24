import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from '../src/pages/SettingsPage';
import { apiClient } from '../src/api/client';
import { useSettingsStore } from '../src/stores/useSettingsStore';

function renderWithClient(ui: React.ReactElement) {
  const testQueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

describe('SettingsPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().resetPreferences();
  });

  it('renders system health diagnostics from backend health API', async () => {
    vi.spyOn(apiClient, 'getHealth').mockResolvedValueOnce({
      status: 'ok',
      database: 'ok',
      ffmpeg_available: true,
      speech: {
        state: 'ready',
        device: 'cuda',
        model: 'small.en',
        compute_type: 'int8_float16',
        gpu_name: 'NVIDIA GeForce RTX 3050 Laptop GPU',
        free_vram_mb: 2800,
        last_error: null,
      },
      tutor: {
        enabled: true,
        provider: 'gemini',
      },
    });

    renderWithClient(<SettingsPage onBackToLibrary={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Local System Diagnostics/i)).toBeInTheDocument();
      expect(screen.getByText(/NVIDIA GeForce RTX 3050 Laptop GPU \(CUDA\)/i)).toBeInTheDocument();
      expect(screen.getByText(/gemini \(cloud\)/i)).toBeInTheDocument();
      expect(screen.getByText('WAL mode enabled')).toBeInTheDocument();
    });
  });

  it('allows changing playback speed and persists in settings store', () => {
    renderWithClient(<SettingsPage onBackToLibrary={vi.fn()} />);

    expect(useSettingsStore.getState().playbackSpeed).toBe(1.0);

    const speed075Btn = screen.getByRole('button', { name: '0.75x' });
    fireEvent.click(speed075Btn);

    expect(useSettingsStore.getState().playbackSpeed).toBe(0.75);

    const speed125Btn = screen.getByRole('button', { name: '1.25x' });
    fireEvent.click(speed125Btn);

    expect(useSettingsStore.getState().playbackSpeed).toBe(1.25);
  });

  it('allows changing tutor language and persists in settings store', () => {
    renderWithClient(<SettingsPage onBackToLibrary={vi.fn()} />);

    expect(useSettingsStore.getState().explanationLanguage).toBe('es');

    const select = screen.getByLabelText(/Tutor Explanation Language/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'fr' } });

    expect(useSettingsStore.getState().explanationLanguage).toBe('fr');
  });

  it('renders configuration guide and does NOT render any password or secret key inputs', () => {
    const { container } = renderWithClient(<SettingsPage onBackToLibrary={vi.fn()} />);

    expect(screen.getByText(/AI Grammar Tutor Configuration Guide/i)).toBeInTheDocument();
    expect(screen.getByText(/API keys are never entered in the web interface/i)).toBeInTheDocument();

    // Verify zero password or secret inputs exist (Section 8.2 security rule)
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBe(0);

    const textInputs = container.querySelectorAll('input[type="text"]');
    expect(textInputs.length).toBe(0);
  });

  it('navigates back to library when Library button is clicked', () => {
    const handleBack = vi.fn();
    renderWithClient(<SettingsPage onBackToLibrary={handleBack} />);

    const backBtn = screen.getByRole('button', { name: /Back to Library/i });
    fireEvent.click(backBtn);

    expect(handleBack).toHaveBeenCalledTimes(1);
  });
});
