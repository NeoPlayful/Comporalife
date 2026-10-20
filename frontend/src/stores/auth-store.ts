import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  nickname: string;
  role: string;
  status: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** 首次校验登录态完成前为 false，避免受保护路由闪烁 */
  initialized: boolean;
  setAuth: (user: AuthUser, accessToken: string) => void;
  setInitialized: () => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  initialized: false,
  setAuth: (user, accessToken) => set({ user, accessToken, initialized: true }),
  setInitialized: () => set({ initialized: true }),
  clear: () => set({ user: null, accessToken: null, initialized: true }),
}));
