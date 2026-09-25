import type { ComponentType } from 'react';
import { ClaudeCheckStep } from './steps/ClaudeCheckStep';
import { ComingSoonStep } from './steps/ComingSoonStep';
import { DoneStep } from './steps/DoneStep';
import { ProfileStep } from './steps/ProfileStep';
import { WelcomeStep } from './steps/WelcomeStep';

export interface StepProps { stepId: string; onNext: () => void }

export interface OnboardingStep {
  id: string;
  titleKey: string;
  status: 'available' | 'coming-soon';
  Component: ComponentType<StepProps>;
}

// Declarative: each later sub-project flips its step to 'available' and plugs in its component.
export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 'welcome', titleKey: 'onboarding.welcome.title', status: 'available', Component: WelcomeStep },
  { id: 'claude', titleKey: 'onboarding.claude.title', status: 'available', Component: ClaudeCheckStep },
  { id: 'profile', titleKey: 'onboarding.profile.title', status: 'available', Component: ProfileStep },
  { id: 'email', titleKey: 'onboarding.email.title', status: 'coming-soon', Component: ComingSoonStep },
  { id: 'done', titleKey: 'onboarding.done.title', status: 'available', Component: DoneStep },
];
