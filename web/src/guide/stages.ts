export type GuideAction = { href: string } | 'coming-soon' | 'none';

export interface GuideStage {
  id: 'install' | 'profile' | 'email' | 'search' | 'review' | 'send' | 'statuses';
  icon: string;
  action: GuideAction;
}

// Later sub-projects switch their stage's action to { href: '#/<page>' } when the page exists.
export const GUIDE_STAGES: GuideStage[] = [
  { id: 'install', icon: '💻', action: 'none' },
  { id: 'profile', icon: '👤', action: { href: '#/profile' } },
  { id: 'email', icon: '✉️', action: 'coming-soon' },
  { id: 'search', icon: '🔎', action: 'coming-soon' },
  { id: 'review', icon: '📝', action: 'coming-soon' },
  { id: 'send', icon: '📤', action: 'coming-soon' },
  { id: 'statuses', icon: '📊', action: 'coming-soon' },
];
