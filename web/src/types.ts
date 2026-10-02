export type {
  ApplicationJobKind, ApplicationJobRunState, ApplicationJobState, ApplicationListView, ApplicationPackage, ApplicationStatus,
  ApplicationSummary, ApplicationView, AttachmentInfo, Availability, DocLanguage, LetterPatch, NewPackageInfo, PackageCv,
  PackageLetter, PackageReadiness, PackageSnapshot, PackageVacancy, CvProposals, CvResult, CvSectionId, EducationEntry, EducationKind, EmploymentType, ErrorCode, ErrorReason,
  ExperienceEntry, FilterReason, FollowUpQuestion, Language, LanguageItem, LanguageLevel, LlmCheck, ManualEdit, ManualInput,
  PersonalData, Profile, ProfileDocument, ProfileView, PublishedWithinDays, Readiness, RemoteKind, RemotePreference, Salutation,
  ScoreState, Section, SectionDataMap, SectionId, SearchPhase, SearchRunState, SearchState, SearchWarning, Settings, SettingsPatch,
  SkillItem, SkillLevel, Story, StoryAnswer, StoryInput, StoryKind, StoredFile, Vacancy, VacancyContact, VacancyListView,
  VacancyScore, VacancyStatus, VacancyTextView, VacancyView, WishesData,
} from '@bp/shared';

export type Route = 'home' | 'profile' | 'vacancies' | 'applications' | 'guide' | 'settings';
