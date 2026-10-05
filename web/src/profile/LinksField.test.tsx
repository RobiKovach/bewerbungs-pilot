import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinksField } from './LinksField';
import { sectionProblem } from './validate';
import { emptyPersonal } from '../test/profileFixtures';

describe('LinksField', () => {
  it('adds a link with a suggested label and reports the change', async () => {
    const onChange = vi.fn();
    render(<LinksField value={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    expect(onChange).toHaveBeenLastCalledWith([{ label: 'GitHub', url: '' }]);
  });
  it('shows at most 3 links: the add button disappears at 3', () => {
    const three = [1, 2, 3].map((i) => ({ label: `L${i}`, url: `https://a${i}.example` }));
    render(<LinksField value={three} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Add a link' })).toBeNull();
  });
  it('marks a non-http address and blocks saving the section', () => {
    render(<LinksField value={[{ label: 'GitHub', url: 'github.com/maxmuster' }]} onChange={() => {}} />);
    expect(screen.getByText('Please enter a full address starting with https://')).toBeInTheDocument();
    expect(sectionProblem('personal', { ...emptyPersonal(), links: [{ label: 'GitHub', url: 'github.com/maxmuster' }] })).toBe('profile.fixLinks');
    expect(sectionProblem('personal', { ...emptyPersonal(), links: [{ label: 'GitHub', url: 'https://github.com/maxmuster' }] })).toBeNull();
  });
  it('treats a whitespace-only label, javascript: addresses and a 4th link as invalid', () => {
    const p = (links: { label: string; url: string }[]) => sectionProblem('personal', { ...emptyPersonal(), links });
    expect(p([{ label: '   ', url: 'https://a.example' }])).toBe('profile.fixLinks');
    expect(p([{ label: 'X', url: 'javascript:alert(1)' }])).toBe('profile.fixLinks');
    expect(p([1, 2, 3, 4].map((i) => ({ label: `L${i}`, url: `https://a${i}.example` })))).toBe('profile.fixLinks');
    expect(p([])).toBeNull();
  });
});
