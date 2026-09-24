export interface WizardStepProps {
  onNext: () => void;
  /** Text of the step's own "next" button; the overview page reuses steps with "Close". */
  nextLabelKey?: string;
}
