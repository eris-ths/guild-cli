import { MemberName } from '../../domain/member/MemberName.js';

export interface Notification {
  from: string;
  to: MemberName;
  type: string;
  text: string;
  related?: string;
  at?: string;
}

export interface NotificationPort {
  post(notification: Notification): Promise<void>;
}
