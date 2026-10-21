import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { configureAuthBridge } from './lib/client';
import { useAuthStore } from './stores/auth-store';
import './index.css';

// 让请求层能读取内存中的 access token，并在刷新成功/会话失效时同步状态
configureAuthBridge({
  getAccessToken: () => useAuthStore.getState().accessToken,
  onRefreshed: (token) => {
    const { user } = useAuthStore.getState();
    if (user) useAuthStore.getState().setAuth(user, token);
  },
  onAuthLost: () => useAuthStore.getState().clear(),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载节点');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
