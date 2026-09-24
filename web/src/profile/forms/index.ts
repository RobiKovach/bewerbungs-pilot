import type { ComponentType } from 'react';
import type { SectionId } from '../../types';
import { EducationForm } from './EducationForm';
import { ExperienceForm } from './ExperienceForm';
import { LanguagesForm } from './LanguagesForm';
import { PersonalForm } from './PersonalForm';
import { SkillsForm } from './SkillsForm';
import type { FormProps } from './types';
import { WishesForm } from './WishesForm';

export type { FormProps };

export const SECTION_FORMS: { [K in SectionId]: ComponentType<FormProps<K>> } = {
  personal: PersonalForm,
  education: EducationForm,
  experience: ExperienceForm,
  skills: SkillsForm,
  languages: LanguagesForm,
  wishes: WishesForm,
};
