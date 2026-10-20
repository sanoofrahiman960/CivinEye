import { render, screen } from '@testing-library/react-native';

import { PriorityBadge } from '../components/PriorityBadge';
import { OverdueBadge, StatusBadge } from '../components/StatusBadge';

describe('badges never rely on colour alone', () => {
  it.each([
    ['CRITICAL', 'Critical'],
    ['HIGH', 'High'],
    ['MEDIUM', 'Medium'],
    ['LOW', 'Low'],
    ['UNCLASSIFIED', 'Unclassified'],
  ] as const)('priority %s shows the text label %s', (priority, label) => {
    render(<PriorityBadge priority={priority} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText(`Priority: ${label}`)).toBeTruthy();
  });

  it('shows short and long status labels', () => {
    const { rerender } = render(<StatusBadge status="RESOLVED" />);
    expect(screen.getByText('Resolved – Verify')).toBeTruthy();
    rerender(<StatusBadge status="RESOLVED" long />);
    expect(screen.getByText('Resolved — Awaiting Citizen Verification')).toBeTruthy();
  });

  it('labels overdue issues', () => {
    render(<OverdueBadge />);
    expect(screen.getByLabelText('Overdue')).toBeTruthy();
  });
});
