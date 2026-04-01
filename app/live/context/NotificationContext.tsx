'use client';

import {
  createContext, useContext, useState,
  useCallback, useEffect,
} from 'react';
import { useAuth } from './AuthContext';

export type NotificationType = 'OUTBID' | 'WATCHED_BID' | 'MARKET' | 'SYSTEM';

export interface Notification {
  id:        string;
  type:      NotificationType;
  title:     string;
  body:      string;
  timestamp: number;
  read:      boolean;
}

interface NotificationContextValue {
  notifications:  Notification[];
  unreadCount:    number;
  addNotification: (type: NotificationType, title: string, body: string) => void;
  markAllRead:    () => void;
  clearAll:       () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const BASE_STORAGE_KEY = 'auction_terminal_notifications_';
const MAX_STORED       = 50; // cap so localStorage never bloats

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Hydrate from localStorage on mount or when user changes
  useEffect(() => {
    try {
      const storageKey = BASE_STORAGE_KEY + (user ? user.id : 'guest');
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setNotifications(JSON.parse(stored));
      } else {
        setNotifications([]);
      }
    } catch { 
      setNotifications([]); 
    }
  }, [user?.id]);

  // Persist on every change
  useEffect(() => {
    try {
      const storageKey = BASE_STORAGE_KEY + (user ? user.id : 'guest');
      localStorage.setItem(storageKey, JSON.stringify(notifications.slice(0, MAX_STORED)));
    } catch { /* silent */ }
  }, [notifications, user?.id]);

  const addNotification = useCallback((
    type:  NotificationType,
    title: string,
    body:  string,
  ) => {
    const next: Notification = {
      id:        `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      title,
      body,
      timestamp: Date.now(),
      read:      false,
    };
    // Prepend — newest first, cap at MAX_STORED
    setNotifications(prev => [next, ...prev].slice(0, MAX_STORED));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      addNotification,
      markAllRead,
      clearAll,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  // Build-safe fallback for pre-rendering
  return ctx || {
    notifications: [],
    unreadCount: 0,
    addNotification: () => {},
    markAllRead: () => {},
    clearAll: () => {},
  } as NotificationContextValue;
}