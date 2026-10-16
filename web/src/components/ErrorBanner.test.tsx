import { afterEach, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsProvider } from '../settings';
import { mockFetch } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import { ErrorBanner } from './ErrorBanner';
import { ApiError } from '../api';
import type { ErrorReason } from '../types';

describe('ErrorBanner', () => {
  it('shows the translated message and hint for a known code', () => {
    render(<ErrorBanner error={new ApiError('LLM_TIMEOUT', 'no answer within 180000 ms')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Claude took too long to answer.');
    expect(screen.getByText('Please try again in a moment.')).toBeInTheDocument();
    expect(screen.getByText(/no answer within 180000 ms/)).toBeInTheDocument();
  });
  it('falls back to UNKNOWN for codes it does not know', () => {
    render(<ErrorBanner error={new ApiError('SOMETHING_NEW', '')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  });
  it('handles plain errors', () => {
    render(<ErrorBanner error={new Error('x')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('with a known reason, shows the translated sentence above a labelled technical line', () => {
    render(<ErrorBanner error={new ApiError('CV_UNREADABLE', 'docx has only 5 characters of text', 'cvTooLittleText', { chars: 5 })} />);
    expect(screen.getByText('The file contains almost no text (5 characters). It is probably empty, or the text is inside a picture.')).toBeInTheDocument();
    expect(screen.getByText('Technical text for support')).toBeInTheDocument();
    expect(screen.getByText(/CV_UNREADABLE: docx has only 5 characters of text/)).toBeInTheDocument();
  });

  it('without a reason, shows only the labelled technical line', () => {
    render(<ErrorBanner error={new ApiError('CV_UNREADABLE', 'docx has only 5 characters of text')} />);
    expect(screen.getByText('Technical text for support')).toBeInTheDocument();
    expect(screen.getByText(/CV_UNREADABLE: docx has only 5 characters of text/)).toBeInTheDocument();
  });

  // A newer server may send a reason this client has no text for.
  it('with an unknown reason, does not crash and still shows the labelled technical line', () => {
    render(<ErrorBanner error={new ApiError('CV_UNREADABLE', 'docx has only 5 characters of text', 'somethingNobodyTranslated' as ErrorReason)} />);
    expect(screen.getByText('Technical text for support')).toBeInTheDocument();
    expect(screen.getByText(/CV_UNREADABLE: docx has only 5 characters of text/)).toBeInTheDocument();
  });

  it('translates PROFILE_NOT_READY missing sections with the existing section-title keys', () => {
    render(<ErrorBanner error={new ApiError('PROFILE_NOT_READY', 'missing: personal, skills', 'profileMissing', { sections: 'personal,skills' })} />);
    expect(screen.getByText('Still missing: Personal details, Skills.')).toBeInTheDocument();
  });

  it('translates FILE_TYPE_NOT_ALLOWED with the allowed types for the given kind', () => {
    render(<ErrorBanner error={new ApiError('FILE_TYPE_NOT_ALLOWED', 'photo: detected .pdf', 'fileTypeDetected', { kind: 'photo', detected: '.pdf' })} />);
    expect(screen.getByText('The file is actually a .pdf file. Allowed here: JPG or PNG.')).toBeInTheDocument();
  });

  describe('link to Settings → AI helper', () => {
    afterEach(() => { window.location.hash = ''; });
    it.each(['LLM_NOT_CHOSEN', 'LLM_NOT_INSTALLED', 'LLM_NOT_LOGGED_IN'])('%s links to the AI helper block in Settings', (code) => {
      render(<ErrorBanner error={new ApiError(code, '')} />);
      expect(screen.getByRole('link', { name: 'Open Settings → AI helper' })).toHaveAttribute('href', '#/settings/ai');
    });
    it('other codes have no such link', () => {
      render(<ErrorBanner error={new ApiError('LLM_TIMEOUT', '')} />);
      expect(screen.queryByRole('link', { name: 'Open Settings → AI helper' })).toBeNull();
    });
    it('not on the Settings page itself', () => {
      window.location.hash = '#/settings';
      render(<ErrorBanner error={new ApiError('LLM_NOT_CHOSEN', '')} />);
      expect(screen.queryByRole('link', { name: 'Open Settings → AI helper' })).toBeNull();
    });
    it('not during the welcome steps (there are no pages to go to)', async () => {
      mockFetch(settingsRoutes(baseSettings({ onboarding: { currentStep: 'profile', completed: false } })).routes);
      render(<SettingsProvider><ErrorBanner error={new ApiError('LLM_NOT_CHOSEN', '')} /></SettingsProvider>);
      expect(await screen.findByRole('alert')).toHaveTextContent('No AI helper is chosen yet.');
      expect(screen.queryByRole('link', { name: 'Open Settings → AI helper' })).toBeNull();
    });
  });
});
