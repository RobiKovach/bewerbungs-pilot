import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
