export type NotificationType = 'booking_request' | 'booking_accepted' | 'booking_rejected' | 'event_reminder' | 'info';

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
};
