import { useTranslation } from 'react-i18next';
import { FollowUps } from '../FollowUps';
import { NeverMentionEditor } from '../NeverMentionEditor';
import { NewStoryForm } from '../NewStoryForm';
import { useProfile } from '../ProfileContext';
import { StoryCard } from '../StoryCard';
import { NextButton } from '../unsaved';
import type { WizardStepProps } from './types';

export function StoriesStep({ onNext, nextLabelKey = 'common.next' }: WizardStepProps) {
  const { t } = useTranslation();
  const { view } = useProfile();
  const { stories } = view.profile;
  return (
    <>
      <p>{t('profile.stories.intro')}</p>
      <FollowUps />
      {stories.length > 0 ? <h2>{t('profile.stories.listTitle')}</h2> : null}
      {/* Keyed by content: a server change (e.g. confirm) starts the card fresh. */}
      {stories.map((s) => <StoryCard key={JSON.stringify(s)} story={s} />)}
      <NewStoryForm />
      <NeverMentionEditor />
      <NextButton onNext={onNext} labelKey={nextLabelKey} />
    </>
  );
}
