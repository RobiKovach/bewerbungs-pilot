import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBanner } from './ErrorBanner';
import { ApiError } from '../api';

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
});
