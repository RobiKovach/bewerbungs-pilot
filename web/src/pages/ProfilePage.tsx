import { ProfileProvider, useProfile } from '../profile/ProfileContext';
import { ProfileOverview } from '../profile/ProfileOverview';
import { ProfileWizard } from '../profile/ProfileWizard';

function ProfileContent() {
  const { view } = useProfile();
  return view.profile.wizard.completedAt === null ? <ProfileWizard /> : <ProfileOverview />;
}

export function ProfilePage() {
  return <ProfileProvider><ProfileContent /></ProfileProvider>;
}
