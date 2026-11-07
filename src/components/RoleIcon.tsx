// One line icon per role, for the invitation page, the Access page and the account menu.
import { BookOpen, Crown, Eye, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Role } from '~/lib/roles';

export const ROLE_ICON: Record<Role, ReactNode> = {
  viewer: <Eye size={20} />,
  contributor: <BookOpen size={20} />,
  editor: <PenLine size={20} />,
  steward: <Crown size={20} />,
};
