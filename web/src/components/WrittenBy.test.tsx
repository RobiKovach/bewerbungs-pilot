import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WrittenBy } from './WrittenBy';

describe('WrittenBy', () => {
  it('shows the provider name and the matching tooltip', () => {
    render(<WrittenBy provider="chatgpt" kind="package" />);
    const chip = screen.getByText('Written by: ChatGPT');
    expect(chip).toHaveAttribute('title', 'This text was written by the AI helper ChatGPT. Check it before sending.');
  });
  it('score tooltip', () => {
    render(<WrittenBy provider="claude" kind="score" />);
    expect(screen.getByText('Written by: Claude')).toHaveAttribute('title', 'Score given by Claude.');
  });
});
