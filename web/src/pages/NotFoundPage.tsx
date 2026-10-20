import { Compass } from 'lucide-react';
import { Link } from 'react-router';

import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  return <EmptyState icon={Compass} title="Page not found" message="The page you're looking for doesn't exist." action={<Link to="/">Go to the dashboard</Link>} />;
}
